"""Generic client-side error of `SkiferClient` (4.1). Typed errors per SK-02.5 arrive in 4.2."""


class SkiferClientError(Exception):
    """Any non-2xx response from skifer, or a 2xx body that does not match the DTO."""

    def __init__(self, status_code: int, body: object) -> None:
        super().__init__(f"skifer API error {status_code}: {body!r}")
        self.status_code = status_code
        self.body = body
