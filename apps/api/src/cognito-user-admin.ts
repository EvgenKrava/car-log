import { ACCESS_GROUP, ADMIN_GROUP } from './admin-guard';
import type { EmailLookup } from './legacy-claim';
import {
  CognitoIdentityProviderClient, ListUsersCommand, ListUsersInGroupCommand,
  AdminAddUserToGroupCommand, AdminRemoveUserFromGroupCommand,
  AdminGetUserCommand,
  type UserType,
} from '@aws-sdk/client-cognito-identity-provider';

export type CognitoUser = {
  username: string;
  sub: string;
  email: string;
  status: string;
  enabled: boolean;
  createdAt: string;
};

export interface CognitoUserAdmin {
  listUsers(nextToken?: string): Promise<{ users: CognitoUser[]; nextToken?: string }>;
  listGroupUsernames(group: string): Promise<Set<string>>;
  addToGroup(username: string, group: string): Promise<void>;
  removeFromGroup(username: string, group: string): Promise<void>;
  setEnabled(username: string, enabled: boolean): Promise<void>;
  deleteUser(username: string): Promise<void>;
  getSub(username: string): Promise<string | null>;
}

const attr = (u: UserType, name: string): string =>
  u.Attributes?.find((a) => a.Name === name)?.Value ?? '';

function toUser(u: UserType): CognitoUser {
  return {
    username: u.Username ?? '',
    sub: attr(u, 'sub'),
    email: attr(u, 'email'),
    status: u.UserStatus ?? 'UNKNOWN',
    enabled: u.Enabled ?? true,
    createdAt: u.UserCreateDate?.toISOString() ?? '',
  };
}

// The pool is the shared Only Tools pool, so CarLog never disables or deletes an account
// (that would lock the person out of every app). "Enabled" means "has the carlog-user role",
// and deleting a CarLog user removes both CarLog roles after their data is purged.
export class AwsCognitoUserAdmin implements CognitoUserAdmin, EmailLookup {
  constructor(private readonly client: CognitoIdentityProviderClient, private readonly userPoolId: string) {}

  async listUsers(nextToken?: string): Promise<{ users: CognitoUser[]; nextToken?: string }> {
    const [res, members] = await Promise.all([
      this.client.send(new ListUsersCommand({ UserPoolId: this.userPoolId, Limit: 60, PaginationToken: nextToken })),
      this.listGroupUsernames(ACCESS_GROUP),
    ]);
    const users = (res.Users ?? []).map(toUser).map((u) => ({ ...u, enabled: u.enabled && members.has(u.username) }));
    return { users, nextToken: res.PaginationToken };
  }

  async listGroupUsernames(group: string): Promise<Set<string>> {
    const names = new Set<string>();
    let token: string | undefined;
    do {
      const res = await this.client.send(new ListUsersInGroupCommand({
        UserPoolId: this.userPoolId, GroupName: group, NextToken: token,
      }));
      for (const u of res.Users ?? []) if (u.Username) names.add(u.Username);
      token = res.NextToken;
    } while (token);
    return names;
  }

  async addToGroup(username: string, group: string): Promise<void> {
    await this.client.send(new AdminAddUserToGroupCommand({ UserPoolId: this.userPoolId, Username: username, GroupName: group }));
  }
  async removeFromGroup(username: string, group: string): Promise<void> {
    await this.client.send(new AdminRemoveUserFromGroupCommand({ UserPoolId: this.userPoolId, Username: username, GroupName: group }));
  }
  async setEnabled(username: string, enabled: boolean): Promise<void> {
    if (enabled) await this.addToGroup(username, ACCESS_GROUP);
    else await this.removeFromGroup(username, ACCESS_GROUP);
  }
  async deleteUser(username: string): Promise<void> {
    await this.removeFromGroup(username, ADMIN_GROUP);
    await this.removeFromGroup(username, ACCESS_GROUP);
  }
  async verifiedEmail(username: string): Promise<string | null> {
    const res = await this.client.send(new AdminGetUserCommand({ UserPoolId: this.userPoolId, Username: username }));
    const get = (n: string) => res.UserAttributes?.find((a) => a.Name === n)?.Value;
    return get('email_verified') === 'true' ? get('email') ?? null : null;
  }
  async getSub(username: string): Promise<string | null> {
    const res = await this.client.send(new AdminGetUserCommand({ UserPoolId: this.userPoolId, Username: username }));
    return res.UserAttributes?.find((a) => a.Name === 'sub')?.Value ?? null;
  }
}
