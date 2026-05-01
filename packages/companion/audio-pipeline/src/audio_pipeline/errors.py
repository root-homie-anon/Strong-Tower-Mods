class AudioPipelineError(Exception):
    def __init__(self, code: str, message: str, status_code: int = 500) -> None:
        super().__init__(message)
        self.code = code
        self.status_code = status_code


class CloudConnectionError(AudioPipelineError):
    def __init__(self, message: str) -> None:
        super().__init__('CLOUD_CONNECTION_ERROR', message, 502)


class TurnRequestError(AudioPipelineError):
    def __init__(self, message: str) -> None:
        super().__init__('TURN_REQUEST_ERROR', message, 500)


class ValidationError(AudioPipelineError):
    def __init__(self, message: str) -> None:
        super().__init__('VALIDATION_ERROR', message, 400)


class CloudAuthError(AudioPipelineError):
    """Cloud rejected the sidecar's JWT with AUTH_ERROR. Retrying will not help — the token is bad."""

    def __init__(self, message: str) -> None:
        super().__init__('CLOUD_AUTH_ERROR', message, 502)


class CloudValidationError(AudioPipelineError):
    """Cloud returned VALIDATION_ERROR for a turn.request frame. This is a sidecar bug."""

    def __init__(self, message: str) -> None:
        super().__init__('CLOUD_VALIDATION_ERROR', message, 500)
