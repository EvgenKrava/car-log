import {
  CognitoIdentityProviderClient, ListUsersCommand, ListUsersInGroupCommand,
  AdminAddUserToGroupCommand, AdminRemoveUserFromGroupCommand,
  AdminEnableUserCommand, AdminDisableUserCommand, AdminDeleteUserCommand,
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

export class AwsCognitoUserAdmin implements CognitoUserAdmin {
  constructor(private readonly client: CognitoIdentityProviderClient, private readonly userPoolId: string) {}

  async listUsers(nextToken?: string): Promise<{ users: CognitoUser[]; nextToken?: string }> {
    const res = await this.client.send(new ListUsersCommand({
      UserPoolId: this.userPoolId, Limit: 60, PaginationToken: nextToken,
    }));
    return { users: (res.Users ?? []).map(toUser), nextToken: res.PaginationToken };
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
    await this.client.send(enabled
      ? new AdminEnableUserCommand({ UserPoolId: this.userPoolId, Username: username })
      : new AdminDisableUserCommand({ UserPoolId: this.userPoolId, Username: username }));
  }
  async deleteUser(username: string): Promise<void> {
    await this.client.send(new AdminDeleteUserCommand({ UserPoolId: this.userPoolId, Username: username }));
  }
  async getSub(username: string): Promise<string | null> {
    const res = await this.client.send(new AdminGetUserCommand({ UserPoolId: this.userPoolId, Username: username }));
    return res.UserAttributes?.find((a) => a.Name === 'sub')?.Value ?? null;
  }
}
