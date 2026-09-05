"""Display ID computation.

Hierarchical presentational positions for families and people (ROW_NUMBER
over active entities) and wish display IDs derived from the owner's
display ID.
"""

from typing import Literal

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models import Family, FamilyVerificationStatus, Person, WishType

# Suffix appended to the owner's display_id to form a wish display_id — a
# pure function of wish type (no DB enumeration).
_WISH_TYPE_SUFFIXES: dict[WishType, str] = {
    WishType.practical: "A",
    WishType.fun: "B",
    WishType.adult: "X",
    WishType.family: "-F",
}


def wish_display_id(owner_display_id: str, wish_type: WishType) -> str:
    """Compute a wish's presentational ``display_id`` from its owner's.

    ``display_id = {owner_display_id}{suffix}`` where the suffix is a pure
    function of the wish's type:

    +----------------+--------+
    | Wish type      | Suffix |
    +================+========+
    | ``practical``  | ``A``  |
    +----------------+--------+
    | ``fun``        | ``B``  |
    +----------------+--------+
    | ``adult``      | ``X``  |
    +----------------+--------+
    | ``family``     | ``-F`` |
    +----------------+--------+

    Person wishes get a bare letter (e.g. ``1-1-1A``); family wishes get a
    dash + ``F`` (e.g. ``1-1-F``) so they read as "the family's wish" and
    cannot collide with person wishes.

    *owner_display_id* should be in the view's existing format: flat views
    pass the full owner id (person ``1-1-1``, family ``1-1``); scoped views
    (where the person id is the bare within-family position) pass ``1``,
    yielding ``1A`` / ``1-F`` accordingly.
    """
    return f"{owner_display_id}{_WISH_TYPE_SUFFIXES[wish_type]}"


def compute_position_maps(
    db: Session,
    entity_type: Literal["family", "person"],
    page_entities: list,
    scope: int | None = None,
) -> tuple[dict[int, int], dict[int, int], dict[int, int]]:
    """Compute the raw ROW_NUMBER position maps behind display IDs.

    Returns ``(fam_pos_map, fam_ref_map, per_pos_map)`` where:

    * ``fam_pos_map`` — ``{family_id: position}`` within the referrer
      partition.
    * ``fam_ref_map`` — ``{family_id: referrer_id_or_0}``.
    * ``per_pos_map`` — ``{person_id: position}`` within the family
      partition (empty for ``entity_type="family"``).

    The maps are scope-independent: only the string formatting in
    ``compute_display_ids()`` depends on ``scope``.  Endpoints that need
    positions for entities spanning multiple scopes (e.g. packing slips over
    many families) can call this once for the whole batch instead of calling
    ``compute_display_ids()`` per scope, avoiding a query round-trip per
    scope.

    ``page_entities`` must be non-empty; the family window is resolved from
    the families referenced by the page (see ``compute_display_ids``).
    """
    if not page_entities:
        return {}, {}, {}

    # ROW_NUMBER must be computed over the full partition to preserve
    # pagination continuity.  We scope the query by referrer_id so it
    # doesn't scan the entire table.
    page_family_ids = {e.family_id if entity_type == "person" else e.id for e in page_entities}

    if entity_type == "family":
        # Collect the referrer_ids that appear on this page
        page_referrer_ids = {(e.referrer_id if e.referrer_id is not None else 0) for e in page_entities}
    else:
        # For person views we need family positions — resolve referrer_ids
        # from the families referenced by the page's people.
        fam_rows = db.query(Family.id, Family.referrer_id).filter(Family.id.in_(page_family_ids)).all()
        page_referrer_ids = {(ref_id if ref_id is not None else 0) for _, ref_id in fam_rows}

    # Build the family-position filter.
    # For family views, ``scope`` is a referrer_id.
    # For person views, ``scope`` is a family_id — so we always use the
    # page_referrer_ids approach (resolved from the page's families).
    if entity_type == "family" and scope is not None:
        # Scoped family view (e.g. admin with referrer_id, or referrer's
        # own view).  Compute over all verified families for that referrer.
        fam_filter = [
            Family.deleted_at.is_(None),
            Family.verification_status == FamilyVerificationStatus.verified,
            Family.referrer_id == scope,
        ]
    else:
        # Flat family view or any person view — compute over all verified
        # families whose referrer_id appears on the current page.
        fam_filter = [
            Family.deleted_at.is_(None),
            Family.verification_status == FamilyVerificationStatus.verified,
            func.coalesce(Family.referrer_id, 0).in_(page_referrer_ids),
        ]

    positions = (
        db.query(
            Family.id,
            Family.referrer_id,
            func.row_number()
            .over(
                partition_by=func.coalesce(Family.referrer_id, 0),
                order_by=Family.id,
            )
            .label("rn"),
        )
        .filter(*fam_filter)
        .all()
    )

    fam_pos_map: dict[int, int] = {}
    fam_ref_map: dict[int, int] = {}  # family_id -> referrer_id_or_0
    for fid, ref_id, rn in positions:
        fam_pos_map[fid] = int(rn)
        fam_ref_map[fid] = ref_id if ref_id is not None else 0

    # Filter by family_id, not person_id, so ROW_NUMBER is computed over all
    # people in each family (preserves pagination continuity).
    per_pos_map: dict[int, int] = {}
    if entity_type == "person":
        if scope is not None:
            per_filter = [
                Person.deleted_at.is_(None),
                Person.family_id == scope,
            ]
        else:
            per_filter = [
                Person.deleted_at.is_(None),
                Person.family_id.in_(page_family_ids),
            ]

        positions = (
            db.query(
                Person.id,
                func.row_number()
                .over(
                    partition_by=Person.family_id,
                    order_by=Person.id,
                )
                .label("rn"),
            )
            .filter(*per_filter)
            .all()
        )
        per_pos_map = {pid: int(rn) for pid, rn in positions}

    return fam_pos_map, fam_ref_map, per_pos_map


def compute_display_ids(
    db: Session,
    entity_type: Literal["family", "person"],
    page_entities: list,
    scope: int | None = None,
    *,
    show_status_labels: bool = False,
) -> dict[int, str]:
    """Compute stable display IDs for a page of entities.

    Display IDs are hierarchical positions based on ROW_NUMBER over *active
    only* entities (verified, non-deleted).  Positions are ordered by database
    ``id`` so they are stable across viewers and pagination — a position shifts
    only when an entity before it is created, deleted, restored, or changes
    verification status.

    Format by view:

    +---------------------+---------------------------+----------------------------------+
    | View                | Family                    | Person                           |
    +=====================+===========================+==================================+
    | Flat (admin)        | ``{ref_or_0}-{pos}``      | ``{ref_or_0}-{fam}-{per}``       |
    +---------------------+---------------------------+----------------------------------+
    | Scoped to referrer  | ``{pos}``                 | n/a                              |
    +---------------------+---------------------------+----------------------------------+
    | Scoped to family    | n/a                       | ``{per}``                        |
    +---------------------+---------------------------+----------------------------------+

    Non-enumerated entities (pending, rejected, deleted) receive ``"0"`` or,
    when ``show_status_labels`` is True, their status label (``"PENDING"``,
    ``"REJECTED"``, ``"DELETED"``).

    Args:
        db: database session.
        entity_type: ``"family"`` or ``"person"``.
        page_entities: entities on the current page (used to scope queries).
        scope: ``referrer_id`` for family views, ``family_id`` for person
            views. ``None`` for flat (unscoped) views.
        show_status_labels: if True, non-enumerated entities get their status
            label instead of ``"0"``.

    Returns:
        ``{entity.id: display_id}`` for each entity in page_entities.
    """
    fam_pos_map, fam_ref_map, per_pos_map = compute_position_maps(db, entity_type, page_entities, scope)

    # ------------------------------------------------------------------ #
    # Format display IDs
    # ------------------------------------------------------------------ #
    result: dict[int, str] = {}

    for entity in page_entities:
        eid = entity.id

        if entity_type == "family":
            if eid in fam_pos_map:
                pos = fam_pos_map[eid]
                ref = fam_ref_map[eid]
                if scope is not None:
                    result[eid] = str(pos)
                else:
                    result[eid] = f"{ref}-{pos}"
            else:
                # Not in active enumeration (pending / rejected / deleted)
                if show_status_labels:
                    if entity.deleted_at is not None:
                        result[eid] = "DELETED"
                    else:
                        result[eid] = entity.verification_status.value.upper()
                else:
                    result[eid] = "0"

        elif entity_type == "person":
            fid = entity.family_id
            if eid in per_pos_map and fid in fam_pos_map:
                fpos = fam_pos_map[fid]
                ppos = per_pos_map[eid]
                ref = fam_ref_map[fid]
                if scope is not None:
                    # Scoped to family — show person position only
                    result[eid] = str(ppos)
                else:
                    result[eid] = f"{ref}-{fpos}-{ppos}"
            else:
                if show_status_labels and entity.deleted_at is not None:
                    result[eid] = "DELETED"
                else:
                    result[eid] = "0"

    return result
