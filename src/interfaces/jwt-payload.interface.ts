export interface IJwtPayload {
  domain: string;
  exp: number;
  iss: string;
  aud: "agent-api" | "client-api";
  sub: string;
}``