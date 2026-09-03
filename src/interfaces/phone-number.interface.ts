export interface IClientPhoneNumber {
  id: string;
  number: string;
  title?: string;
  country_code?: string;
  dial_code?: string;
  status: 'active' | 'inactive' | 'pending' | string;
  capabilities?: {
    voice?: boolean;
    sms?: boolean;
  };
  enable_outbound?: boolean;
  shared_teams_id?: string[];
  created_at?: string;
}

export interface IClientPhoneNumbersResponse {
  data: IClientPhoneNumber[];
  meta: {
    total: number;
    page: number;
    limit: number;
    total_pages: number;
  };
}
