from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from backend.auth.models import User
from backend.core.database import get_db
from backend.coupons import service
from backend.coupons.dtos import CouponCreate, CouponPage, CouponResponse, CouponUpdate, RedeemCoupon, RedemptionPage, RedemptionResponse
from backend.dependencies import get_current_user, require_superuser

router = APIRouter(prefix="/coupons", tags=["Coupons"])
Database = Annotated[Session, Depends(get_db)]
CurrentUser = Annotated[User, Depends(get_current_user)]
Superuser = Annotated[User, Depends(require_superuser)]
Page = Annotated[int, Query(ge=1)]
PageSize = Annotated[int, Query(ge=1, le=100)]


@router.post("/redeem", response_model=RedemptionResponse)
def redeem(data: RedeemCoupon, user: CurrentUser):
    return service.redeem(data, user.id)


@router.get("/me/redemptions", response_model=RedemptionPage)
def my_redemptions(db: Database, user: CurrentUser, page: Page = 1, page_size: PageSize = 20):
    return service.list_redemptions(db, page, page_size, user_id=user.id)


@router.post("", response_model=CouponResponse, status_code=201)
def create(data: CouponCreate, user: Superuser):
    return service.create_coupon(data, user.id)


@router.get("", response_model=CouponPage)
def list_coupons(db: Database, _: Superuser, page: Page = 1, page_size: PageSize = 20):
    return service.list_coupons(db, page, page_size)


@router.patch("/{coupon_id}", response_model=CouponResponse)
def update(coupon_id: str, data: CouponUpdate, user: Superuser):
    return service.update_coupon(coupon_id, data, user.id)


@router.get("/{coupon_id}/redemptions", response_model=RedemptionPage)
def coupon_redemptions(coupon_id: str, db: Database, _: Superuser, page: Page = 1, page_size: PageSize = 20):
    return service.list_redemptions(db, page, page_size, coupon_id=coupon_id)
