import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi import FastAPI

from backend.auth.controller import router as auth_router
from backend.users.controller import router as users_router
from backend.core.database import Base, engine
from backend.auth.models import User  


Base.metadata.create_all(bind=engine)

app = FastAPI(title="FastAPI JWT Auth")

app.include_router(auth_router)
app.include_router(users_router)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("backend.main:app", host="0.0.0.0", port=8000, reload=True)
