export class DomainError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.code = code;
    this.details = details;
  }
}
export class ConflictError extends DomainError {
  constructor(message = 'Os dados foram alterados em outra aba ou dispositivo. Recarregue para ver a versão atual.', details = null) {
    super('CONFLICT', message, details);
  }
}
export class UnsupportedError extends DomainError {
  constructor(feature) {
    super('UNSUPPORTED', `“${feature}” não está disponível neste modo.`);
  }
}
