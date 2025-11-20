import csv
import io
from typing import Any

from fastapi import APIRouter, StreamingResponse
from sqlmodel import select

from app.api.deps import SessionDep
from app.models import FamilyMember

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

    for f in family_members:
        writer.writerow([f.owner_id, f.given_name, f.family_role, f.age, f.practical_wish, f.fun_wish, f.note])
    
    buffer.seek(0)

    return StreamingResponse(
        buffer,
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=wishlist.csv"}
    )