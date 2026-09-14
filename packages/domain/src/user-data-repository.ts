// Bulk removal of every row under one owner's partition. Implemented by the DynamoDB
// adapter (Query keys-only + BatchWrite); the in-memory adapter records the call.
export interface UserDataRepository {
  deleteAllForOwner(ownerId: string): Promise<number>;
}

// The identity-provider side of account deletion. CognitoUserAdmin satisfies it.
export interface IdentityDeleter {
  deleteUser(username: string): Promise<void>;
}
