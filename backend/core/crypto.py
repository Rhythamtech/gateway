"""Encryption helpers for provider credentials stored at rest."""

import base64
import hashlib
import logging
from functools import lru_cache

from cryptography.fernet import Fernet, InvalidToken

from backend.core.config import settings

logger = logging.getLogger(__name__)

_PREFIX = "enc:v1:"


class CredentialError(Exception):
    """Raised when a stored credential cannot be decrypted."""


@lru_cache(maxsize=1)
def _fernet() -> Fernet:
    material = settings.PROVIDER_ENCRYPTION_KEY or settings.JWT_SECRET_KEY

    if not material:
        raise CredentialError("No credential encryption key is configured")

    # Derive a valid Fernet key from arbitrary configuration material. This
    # keeps the setting easy to provide while still using a proper AEAD cipher.
    digest = hashlib.sha256(material.encode("utf-8")).digest()
    key = base64.urlsafe_b64encode(digest)

    return Fernet(key)


def encrypt_secret(value: str | None) -> str:
    """Encrypt a credential for storage. Empty values are stored as empty."""

    if not value:
        return ""

    token = _fernet().encrypt(value.encode("utf-8")).decode("ascii")
    return f"{_PREFIX}{token}"


def decrypt_secret(value: str | None) -> str:
    """Decrypt a stored credential.

    Raises CredentialError without including any credential material in the
    message when the value cannot be decrypted.
    """

    if not value:
        return ""

    if not value.startswith(_PREFIX):
        # Fail closed rather than treating an unexpected value as plaintext.
        raise CredentialError("Stored credential is not encrypted")

    token = value[len(_PREFIX):]

    try:
        return _fernet().decrypt(token.encode("ascii")).decode("utf-8")
    except (InvalidToken, ValueError, UnicodeError):
        raise CredentialError("Stored credential could not be decrypted") from None
