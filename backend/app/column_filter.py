"""Column filtering: the ``columns`` query param for admin list endpoints.

Parses the comma-separated ``columns`` param, lets endpoints check which
fields a response needs (to skip dependent DB lookups), and trims items to
the requested fields (always including required and always-include fields).
"""

import math
from dataclasses import dataclass

from fastapi import HTTPException, status


@dataclass
class ColumnRequest:
    """Parsed column filter from the ``columns`` query parameter.

    Use ``request.needs("field_name")`` to check whether a column
    (and its dependent DB lookups) are required for the response.
    When the client sends no ``columns`` param, all fields are needed.
    """

    _requested: set[str] | None = None

    @classmethod
    def parse(cls, columns: str | None) -> "ColumnRequest":
        if columns is None:
            return cls(None)
        return cls({c.strip() for c in columns.split(",") if c.strip()})

    def needs(self, *field_names: str) -> bool:
        """Return True if any of the given field names are needed."""
        if self._requested is None:
            return True
        return any(name in self._requested for name in field_names)


def _get_required_fields(item) -> set[str]:
    """Extract required field names from a Pydantic model instance."""
    required: set[str] = set()
    for name, field_info in type(item).model_fields.items():
        if field_info.is_required():
            required.add(name)
    return required


def apply_column_filter(items: list, columns: str | None, *, always_include: set[str] | None = None) -> list[dict]:
    """Filter model instances (or dicts) to only include requested columns.

    When *columns* is None, return full model_dump for each item (or the dicts
    as-is).
    When *columns* is provided, serialize with model_dump(include=...) using
    the comma-separated field names. *always_include* fields are forced into
    the selection (e.g. "id" for mutations, "wishes" for people).

    Required fields from the Pydantic model are always included regardless of
    the column filter, so the partial dicts remain valid against the response
    schema.

    Raises 400 if any requested column name is not a valid field on the
    response model (whitelist enforcement).
    """
    if columns is None:
        if items and isinstance(items[0], dict):
            return list(items)
        return [item.model_dump() for item in items]

    requested = set(c.strip() for c in columns.split(",") if c.strip())
    if always_include:
        requested.update(always_include)

    # Always include required fields so partial dicts satisfy the response schema
    if items and hasattr(type(items[0]), "model_fields"):
        requested.update(_get_required_fields(items[0]))

    # Validate against whitelist — reject unknown column names
    if items and hasattr(type(items[0]), "model_fields"):
        allowed = set(type(items[0]).model_fields.keys())
        unknown = requested - allowed
        if unknown:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Unknown column(s): {', '.join(sorted(unknown))}",
            )

    if items and isinstance(items[0], dict):
        return [{k: v for k, v in item.items() if k in requested} for item in items]
    return [item.model_dump(include=requested) for item in items]


def column_filtered_page(
    items: list,
    columns: str | None,
    *,
    key: str,
    total: int,
    page: int,
    page_size: int,
    always_include: set[str] | None = None,
) -> dict:
    """Build the paginated, column-filtered list envelope.

    Returns ``{"<key>": items, "total", "page", "page_size", "total_pages"}`` where the
    items are filtered through :func:`apply_column_filter`.

    NOTE: Returns a plain dict (not the ``*ListResponse`` model) because
    apply_column_filter produces partial dicts with only requested columns.
    FastAPI validates this dict against the annotated response model —
    required fields are always included so validation passes.
    """
    return {
        key: apply_column_filter(items, columns, always_include=always_include),
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": math.ceil(total / page_size) if total else 0,
    }
