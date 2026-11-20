// Subset of Mercado Pago API payloads used by this server. Fields the API may
// omit are optional; fields it returns as explicit null are typed `| null`.

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export type PaymentStatus =
  | "pending"
  | "approved"
  | "authorized"
  | "in_process"
  | "in_mediation"
  | "rejected"
  | "cancelled"
  | "refunded"
  | "charged_back";

export type PaymentTypeId =
  | "account_money"
  | "ticket"
  | "bank_transfer"
  | "atm"
  | "credit_card"
  | "debit_card"
  | "prepaid_card"
  | "digital_currency"
  | "digital_wallet"
  | "voucher_card"
  | "crypto_transfer";

export interface Identification {
  type?: string | null;
  number?: string | null;
}

export interface Payer {
  id?: string | number | null;
  email?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  identification?: Identification | null;
  type?: string | null;
}

export interface Refund {
  id: number;
  payment_id: number;
  amount: number;
  status: string;
  date_created: string;
  source?: { id?: string; name?: string; type?: string } | null;
  metadata?: Record<string, JsonValue> | null;
  unique_sequence_number?: string | null;
}

export interface Payment {
  id: number;
  status: PaymentStatus | string;
  status_detail?: string | null;
  date_created: string;
  date_approved?: string | null;
  date_last_updated?: string | null;
  money_release_date?: string | null;
  operation_type?: string | null;
  payment_method_id?: string | null;
  payment_type_id?: PaymentTypeId | string | null;
  currency_id: string;
  transaction_amount: number;
  transaction_amount_refunded?: number | null;
  installments?: number | null;
  description?: string | null;
  external_reference?: string | null;
  live_mode?: boolean;
  payer?: Payer | null;
  order?: { id?: string | number | null; type?: string | null } | null;
  metadata?: Record<string, JsonValue> | null;
  transaction_details?: {
    net_received_amount?: number | null;
    total_paid_amount?: number | null;
    installment_amount?: number | null;
    overpaid_amount?: number | null;
  } | null;
  fee_details?: Array<{ type: string; amount: number; fee_payer?: string | null }>;
  refunds?: Refund[];
}

export interface Paging {
  total: number;
  limit: number;
  offset: number;
}

export interface PaymentSearchResponse {
  paging: Paging;
  results: Payment[];
}

export interface MerchantOrder {
  id: number;
  status: string;
  order_status?: string | null;
  external_reference?: string | null;
  preference_id?: string | null;
  date_created?: string | null;
  last_updated?: string | null;
  total_amount?: number | null;
  paid_amount?: number | null;
  refunded_amount?: number | null;
  shipping_cost?: number | null;
  cancelled?: boolean | null;
  notification_url?: string | null;
  payments: Array<{
    id: number;
    status: string;
    status_detail?: string | null;
    transaction_amount: number;
    total_paid_amount?: number | null;
    currency_id?: string | null;
    date_approved?: string | null;
  }>;
  items: Array<{
    id?: string | null;
    title?: string | null;
    quantity: number;
    unit_price: number;
    currency_id?: string | null;
  }>;
}

export interface PreferenceItem {
  id?: string;
  title: string;
  description?: string;
  picture_url?: string;
  category_id?: string;
  quantity: number;
  unit_price: number;
  currency_id?: string;
}

export interface BackUrls {
  success?: string;
  pending?: string;
  failure?: string;
}

export interface Preference {
  id: string;
  init_point: string;
  sandbox_init_point?: string | null;
  collector_id?: number | null;
  client_id?: string | null;
  date_created?: string | null;
  external_reference?: string | null;
  notification_url?: string | null;
  back_urls?: BackUrls | null;
  auto_return?: string | null;
  expires?: boolean | null;
  expiration_date_from?: string | null;
  expiration_date_to?: string | null;
  items: PreferenceItem[];
  payer?: Payer | null;
  metadata?: Record<string, JsonValue> | null;
}

export interface PreferenceCreateRequest {
  items: PreferenceItem[];
  external_reference?: string;
  notification_url?: string;
  back_urls?: BackUrls;
  auto_return?: "approved" | "all";
  statement_descriptor?: string;
  payer?: { email?: string; name?: string; surname?: string };
  expires?: boolean;
  expiration_date_from?: string;
  expiration_date_to?: string;
  metadata?: Record<string, string | number | boolean>;
}

export interface RefundCreateRequest {
  amount?: number;
}

export interface PaymentMethod {
  id: string;
  name: string;
  payment_type_id: PaymentTypeId | string;
  status: string;
  secure_thumbnail?: string | null;
  thumbnail?: string | null;
  deferred_capture?: string | null;
  min_allowed_amount?: number | null;
  max_allowed_amount?: number | null;
  accreditation_time?: number | null;
  processing_modes?: string[];
}

export interface MercadoPagoErrorCause {
  code?: string | number;
  description?: string;
  data?: string | null;
}

export interface MercadoPagoErrorBody {
  message?: string;
  error?: string;
  status?: number;
  cause?: MercadoPagoErrorCause[] | MercadoPagoErrorCause | null;
}
