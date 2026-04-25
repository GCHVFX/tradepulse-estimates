export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      tpe_businesses: {
        Row: {
          email: string | null
          logo_url: string | null
          name: string
          phone: string | null
          prepared_by: string
          signup_source: string | null
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          subscription_status: string
          trial_ends_at: string | null
          user_id: string
        }
        Insert: {
          email?: string | null
          logo_url?: string | null
          name: string
          phone?: string | null
          prepared_by?: string
          signup_source?: string | null
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          subscription_status?: string
          trial_ends_at?: string | null
          user_id?: string
        }
        Update: {
          email?: string | null
          logo_url?: string | null
          name?: string
          phone?: string | null
          prepared_by?: string
          signup_source?: string | null
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          subscription_status?: string
          trial_ends_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      tpe_customers: {
        Row: {
          address: string | null
          business_id: string
          email: string | null
          id: string
          name: string | null
          phone: string | null
        }
        Insert: {
          address?: string | null
          business_id?: string
          email?: string | null
          id?: string
          name?: string | null
          phone?: string | null
        }
        Update: {
          address?: string | null
          business_id?: string
          email?: string | null
          id?: string
          name?: string | null
          phone?: string | null
        }
        Relationships: []
      }
      tpe_estimates: {
        Row: {
          assumptions: string | null
          business_id: string | null
          created_at: string | null
          customer_address: string
          customer_email: string
          customer_id: string | null
          customer_name: string
          customer_phone: string
          deposit_amount: string | null
          id: string
          line_items: Json | null
          notes: string | null
          payment_terms: string | null
          prepared_by: string
          pricing: Json | null
          scope: string | null
          sent_at: string | null
          sent_via: string | null
          status: string | null
          summary: string | null
          title: string | null
        }
        Insert: {
          assumptions?: string | null
          business_id?: string | null
          created_at?: string | null
          customer_address?: string
          customer_email?: string
          customer_id?: string | null
          customer_name?: string
          customer_phone?: string
          deposit_amount?: string | null
          id?: string
          line_items?: Json | null
          notes?: string | null
          payment_terms?: string | null
          prepared_by?: string
          pricing?: Json | null
          scope?: string | null
          sent_at?: string | null
          sent_via?: string | null
          status?: string | null
          summary?: string | null
          title?: string | null
        }
        Update: {
          assumptions?: string | null
          business_id?: string | null
          created_at?: string | null
          customer_address?: string
          customer_email?: string
          customer_id?: string | null
          customer_name?: string
          customer_phone?: string
          deposit_amount?: string | null
          id?: string
          line_items?: Json | null
          notes?: string | null
          payment_terms?: string | null
          prepared_by?: string
          pricing?: Json | null
          scope?: string | null
          sent_at?: string | null
          sent_via?: string | null
          status?: string | null
          summary?: string | null
          title?: string | null
        }
        Relationships: []
      }
      tpe_price_book: {
        Row: {
          created_at: string
          deposit_percent: number | null
          deposit_threshold: number | null
          id: string
          labour_rate: number
          markup_percent: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          deposit_percent?: number | null
          deposit_threshold?: number | null
          id?: string
          labour_rate?: number
          markup_percent?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          deposit_percent?: number | null
          deposit_threshold?: number | null
          id?: string
          labour_rate?: number
          markup_percent?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      tpe_price_book_items: {
        Row: {
          created_at: string
          id: string
          name: string
          unit: string
          unit_price: number
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          unit?: string
          unit_price?: number
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          unit?: string
          unit_price?: number
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
