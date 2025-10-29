import uuid
from typing import Any

from fastapi import APIRouter, HTTPException
from sqlmodel import func, select

from app.api.deps import CurrentUser, SessionDep
from app.models import FamilyMember, FamilyMemberCreate, FamilyMemberPublic, FamilyMembersPublic, FamilyMemberUpdate, Message

router = APIRouter(prefix="/family-members", tags=["family-members"])


@router.get("/", response_model=FamilyMembersPublic)
def read_family_members(
    session: SessionDep, current_user: CurrentUser, skip: int = 0, limit: int = 100
) -> Any:
    """
    Retrieve family_members.
    """

    if current_user.is_superuser:
        count_statement = select(func.count()).select_from(FamilyMember)
        count = session.exec(count_statement).one()
        statement = select(FamilyMember).offset(skip).limit(limit)
        family_members = session.exec(statement).all()
    else:
        count_statement = (
            select(func.count())
            .select_from(FamilyMember)
            .where(FamilyMember.owner_id == current_user.id)
        )
        count = session.exec(count_statement).one()
        statement = (
            select(FamilyMember)
            .where(FamilyMember.owner_id == current_user.id)
            .offset(skip)
            .limit(limit)
        )
        family_members = session.exec(statement).all()

    return FamilyMembersPublic(data=family_members, count=count)


@router.get("/{id}", response_model=FamilyMemberPublic)
def read_family_member(session: SessionDep, current_user: CurrentUser, id: uuid.UUID) -> Any:
    """
    Get family_member by ID.
    """
    family_member = session.get(FamilyMember, id)
    if not family_member:
        raise HTTPException(status_code=404, detail="FamilyMember not found")
    if not current_user.is_superuser and (family_member.owner_id != current_user.id):
        raise HTTPException(status_code=400, detail="Not enough permissions")
    return family_member


@router.post("/", response_model=FamilyMemberPublic)
def create_family_member(
    *, session: SessionDep, current_user: CurrentUser, family_member_in: FamilyMemberCreate
) -> Any:
    """
    Create new family_member.
    """
    family_member = FamilyMember.model_validate(family_member_in, update={"owner_id": current_user.id})
    session.add(family_member)
    session.commit()
    session.refresh(family_member)
    return family_member


@router.put("/{id}", response_model=FamilyMemberPublic)
def update_family_member(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    id: uuid.UUID,
    family_member_in: FamilyMemberUpdate,
) -> Any:
    """
    Update an family_member.
    """
    family_member = session.get(FamilyMember, id)
    if not family_member:
        raise HTTPException(status_code=404, detail="FamilyMember not found")
    if not current_user.is_superuser and (family_member.owner_id != current_user.id):
        raise HTTPException(status_code=400, detail="Not enough permissions")
    update_dict = family_member_in.model_dump(exclude_unset=True)
    family_member.sqlmodel_update(update_dict)
    session.add(family_member)
    session.commit()
    session.refresh(family_member)
    return family_member


@router.delete("/{id}")
def delete_family_member(
    session: SessionDep, current_user: CurrentUser, id: uuid.UUID
) -> Message:
    """
    Delete an family_member.
    """
    family_member = session.get(FamilyMember, id)
    if not family_member:
        raise HTTPException(status_code=404, detail="FamilyMember not found")
    if not current_user.is_superuser and (family_member.owner_id != current_user.id):
        raise HTTPException(status_code=400, detail="Not enough permissions")
    session.delete(family_member)
    session.commit()
    return Message(message="FamilyMember deleted successfully")
