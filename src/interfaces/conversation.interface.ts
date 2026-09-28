export interface IConversationLastMessage {
  id: string;
  body: string;
  direction: "inbound" | "outbound";
  sender_type: "client" | "agent" | "system" | "voice_agent";
  sender_id?: string | null;
  created_at: string;
}

export interface IConversation {
  id: string;
  workspace_id: string;
  phone_number_id: string;
  system_number: string;
  client_number: string;
  client_name?: string | null;
  contact_id?: string | null;
  assigned_agent_id?: string | null;
  assigned_team_id?: string | null;
  status: "open" | "closed";
  unread_count: number;
  last_message?: IConversationLastMessage | null;
  last_message_at?: string | null;
  last_read_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface IConversationMessage {
  id: string;
  conversation_id: string;
  workspace_id: string;
  phone_number_id: string;
  from: string;
  from_number?: string;
  to: string;
  to_number?: string;
  client_number: string;
  body: string;
  direction: "inbound" | "outbound";
  status: "queued" | "sending" | "sent" | "delivered" | "failed" | "received";
  sender_type: "client" | "agent" | "system" | "voice_agent";
  sender_id?: string | null;
  media_urls?: string[];
  cost?: number;
  error_code?: string | null;
  error_message?: string | null;
  created_at: string;
  updated_at: string;
}

export interface IListConversationsQuery {
  status?: "open" | "closed" | "all";
  assigned_to?: string;
  assigned_team_id?: string;
  unread_only?: boolean;
  search?: string;
  page?: number;
  limit?: number;
}

export interface IListConversationsResponse {
  data: IConversation[];
  meta: {
    total: number;
    page: number;
    limit: number;
    total_pages: number;
  };
}

export interface IListMessagesQuery {
  page?: number;
  limit?: number;
  before?: string;
  after?: string;
}

export interface IListMessagesResponse {
  data: IConversationMessage[];
  meta: {
    total: number;
    page: number;
    limit: number;
    total_pages: number;
  };
}

export interface IStartConversationPayload {
  from: string;
  client_number: string;
  /** @deprecated Optional alias for client_number */
  to?: string;
  body: string;
  media_urls?: string[];
  contact_id?: string;
  assigned_agent_id?: string;
  assigned_team_id?: string;
}

export interface IStartConversationResponse {
  conversation: IConversation;
  message: IConversationMessage;
}

export interface ISendMessagePayload {
  body: string;
  media_urls?: string[];
}

export interface IUpdateConversationPayload {
  assigned_agent_id?: string | null;
  assigned_team_id?: string | null;
  status?: "open" | "closed";
}

export interface IMarkAsReadResponse {
  ok: boolean;
  conversation_id: string;
}

export interface IMessageReceivedEvent {
  id: string;
  conversation_id: string;
  from: string;
  from_number?: string;
  to: string;
  to_number?: string;
  client_number: string;
  client_name?: string | null;
  body: string;
  direction: "inbound";
  status: "received";
  sender_type: "client";
  media_urls?: string[];
  phone_number_id?: string;
  unread_count?: number;
  created_at: string;
}

export interface IMessageSentEvent {
  id: string;
  conversation_id: string;
  from: string;
  from_number?: string;
  to: string;
  to_number?: string;
  client_number: string;
  client_name?: string | null;
  body: string;
  direction: "outbound";
  status: string;
  sender_type: string;
  sender_id?: string | null;
  media_urls?: string[];
  phone_number_id?: string;
  unread_count?: number;
  created_at: string;
}

export interface IMessageUpdatedEvent {
  id: string;
  conversation_id?: string;
  status: string;
  cost?: number;
  error_code?: string | null;
  error_message?: string | null;
  updated_at?: string;
}
