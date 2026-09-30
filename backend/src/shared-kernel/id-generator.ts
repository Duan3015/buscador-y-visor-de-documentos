import { randomUUID } from 'node:crypto';

export const ID_GENERATOR = Symbol('IdGenerator');

export interface IdGenerator {
  newId(): string;
}

export class UuidGenerator implements IdGenerator {
  newId(): string {
    return randomUUID();
  }
}
