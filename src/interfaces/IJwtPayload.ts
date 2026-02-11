export interface IJwtPayload {
  username: string;
  domain: string;
  exp: number;
  iss: string;
  aud: string;
  sub: string;
}