export interface ISession {
    session_id: string;
    display_name: string;
    username: string;
    domain: string;
    avatar?: string;
    ext?: string;
    expires_at: number;
}