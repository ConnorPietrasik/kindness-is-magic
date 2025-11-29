import csv
import io
from typing import Any

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from sqlmodel import select

from app.api.deps import SessionDep, get_current_active_superuser
from app.models import FamilyMember, User


router = APIRouter(prefix="/wishlist", tags=["wishlist"])


@router.get("/")
def read_wishlists(
    session: SessionDep) -> Any:
    """
    Retrieve master wishlist.
    """

    statement = select(FamilyMember)
    family_members = session.exec(statement).all()

    buffer = io.StringIO()
    writer = csv.writer(buffer)

    writer.writerow(["Family ID", "Given Name", "Family Role", "Age", "Practical Wish", "Fun Wish", "Note"])

    for f in family_members:
        writer.writerow([f.owner_id, f.given_name, f.family_role, f.age, f.practical_wish, f.fun_wish, f.note])

    buffer.seek(0)

    return StreamingResponse(
        buffer,
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=wishlist.csv"}
    )


@router.get(
    "/admin",
    dependencies=[Depends(get_current_active_superuser)]
)
def read_users(session: SessionDep) -> Any:
    """
    Retrieve admin wishlist with contact info included.
    """

    statement = select(FamilyMember, User).where(FamilyMember.owner_id == User.id)
    family_members = session.exec(statement).all()

    buffer = io.StringIO()
    writer = csv.writer(buffer)

    writer.writerow(["Family Head Name", "Family Email", "Family Address", "Family Phone", "Given Name", "Family Role", "Age", "Practical Wish", "Fun Wish", "Note"])

    for f, o in family_members:
        writer.writerow([o.full_name, o.email, o.address, o.phone, f.given_name, f.family_role, f.age, f.practical_wish, f.fun_wish, f.note])

    buffer.seek(0)

    return StreamingResponse(
        buffer,
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=wishlist.csv"}
    )