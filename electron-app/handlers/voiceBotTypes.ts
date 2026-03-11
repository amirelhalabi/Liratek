/**
 * Voice Bot TypeScript types and interfaces
 */

export interface VoiceCommand {
  module: string;
  action: string;
  provider?: "OMT" | "WHISH";
  entities: VoiceCommandEntities;
}

export interface VoiceCommandEntities {
  amount?: number;
  phone?: string;
  name?: string;
  product?: string;
  quantity?: number;
  serviceType?: "SEND" | "RECEIVE";
  senderName?: string;
  senderPhone?: string;
  receiverName?: string;
  receiverPhone?: string;
  targetPage?: string;
  fromDate?: string;
  toDate?: string;
  status?: string;
  filter?: string;
}

export interface ParseResult {
  success: boolean;
  command?: VoiceCommand;
  error?: string;
}

export interface ExecuteResult {
  success: boolean;
  message?: string;
  error?: string;
  entities?: VoiceCommandEntities;
  route?: string;
  filters?: Record<string, unknown>;
}

export interface OmtWhishExecuteResult extends ExecuteResult {
  entities?: {
    amount: number;
    receiverPhone?: string;
    receiverName?: string;
    senderPhone?: string;
    senderName?: string;
  };
}

export interface RechargeExecuteResult extends ExecuteResult {
  entities?: {
    phone: string;
    amount: number;
  };
}

export interface PosExecuteResult extends ExecuteResult {
  entities?: {
    product?: string;
    quantity?: number;
    amount?: number;
  };
}

export interface DebtsExecuteResult extends ExecuteResult {
  entities?: {
    name?: string;
    amount?: number;
    phone?: string;
  };
}

export interface NavigationExecuteResult extends ExecuteResult {
  route?: string;
  filters?: {
    fromDate?: string;
    toDate?: string;
    status?: string;
  };
}
