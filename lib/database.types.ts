export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      tpe_businesses: {
        Row: {
          email: string | null
          google_review_link: string | null
          logo_url: string | null
          name: string
          payment_link: string | null
          phone: string | null
          plan: string
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
          google_review_link?: string | null
          logo_url?: string | null
          name: string
          payment_link?: string | null
          phone?: string | null
          plan?: string
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
          google_review_link?: string | null
          logo_url?: string | null
          name?: string
          payment_link?: string | null
          phone?: string | null
          plan?: string
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
      tpe_estimate_changes: {
        Row: {
          change_type: string
          changed_at: string | null
          created_at: string | null
          estimate_id: string
          id: string
          new_value: Json | null
          old_value: Json | null
          user_id: string
        }
        Insert: {
          change_type: string
          changed_at?: string | null
          created_at?: string | null
          estimate_id: string
          id?: string
          new_value?: Json | null
          old_value?: Json | null
          user_id: string
        }
        Update: {
          change_type?: string
          changed_at?: string | null
          created_at?: string | null
          estimate_id?: string
          id?: string
          new_value?: Json | null
          old_value?: Json | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tpe_estimate_changes_estimate_id_fkey"
            columns: ["estimate_id"]
            isOneToOne: false
            referencedRelation: "tpe_estimates"
            referencedColumns: ["id"]
          },
        ]
      }
      tpe_estimates: {
        Row: {
          assumptions: string | null
          business_id: string | null
          completed_at: string | null
          copied_at: string | null
          created_at: string | null
          customer_address: string
          customer_email: string
          customer_id: string | null
          customer_name: string
          customer_phone: string
          deposit_amount: string | null
          due_date: string | null
          id: string
          include_photos: boolean
          invoice_amount: number | null
          last_reminder_sent_at: string | null
          line_items: Json | null
          notes: string | null
          payment_status: string | null
          payment_terms: string | null
          photo_urls: string[]
          prepared_by: string
          pricing: Json | null
          reminder_count: number | null
          review_requested_at: string | null
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
          completed_at?: string | null
          copied_at?: string | null
          created_at?: string | null
          customer_address?: string
          customer_email?: string
          customer_id?: string | null
          customer_name?: string
          customer_phone?: string
          deposit_amount?: string | null
          due_date?: string | null
          id?: string
          include_photos?: boolean
          invoice_amount?: number | null
          last_reminder_sent_at?: string | null
          line_items?: Json | null
          notes?: string | null
          payment_status?: string | null
          payment_terms?: string | null
          photo_urls?: string[]
          prepared_by?: string
          pricing?: Json | null
          reminder_count?: number | null
          review_requested_at?: string | null
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
          completed_at?: string | null
          copied_at?: string | null
          created_at?: string | null
          customer_address?: string
          customer_email?: string
          customer_id?: string | null
          customer_name?: string
          customer_phone?: string
          deposit_amount?: string | null
          due_date?: string | null
          id?: string
          include_photos?: boolean
          invoice_amount?: number | null
          last_reminder_sent_at?: string | null
          line_items?: Json | null
          notes?: string | null
          payment_status?: string | null
          payment_terms?: string | null
          photo_urls?: string[]
          prepared_by?: string
          pricing?: Json | null
          reminder_count?: number | null
          review_requested_at?: string | null
          scope?: string | null
          sent_at?: string | null
          sent_via?: string | null
          status?: string | null
          summary?: string | null
          title?: string | null
        }
        Relationships: []
      }
      tpe_payment_reminders: {
        Row: {
          business_id: string
          channel: string
          estimate_id: string
          id: string
          message: string
          sent_at: string
          stage: string
        }
        Insert: {
          business_id: string
          channel: string
          estimate_id: string
          id?: string
          message: string
          sent_at?: string
          stage: string
        }
        Update: {
          business_id?: string
          channel?: string
          estimate_id?: string
          id?: string
          message?: string
          sent_at?: string
          stage?: string
        }
        Relationships: [
          {
            foreignKeyName: "tpe_payment_reminders_estimate_id_fkey"
            columns: ["estimate_id"]
            isOneToOne: false
            referencedRelation: "tpe_estimates"
            referencedColumns: ["id"]
          },
        ]
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
      tpe_rate_limits: {
        Row: {
          action: string
          count: number
          created_at: string | null
          expires_at: string
          id: string
          key: string
        }
        Insert: {
          action: string
          count?: number
          created_at?: string | null
          expires_at: string
          id?: string
          key: string
        }
        Update: {
          action?: string
          count?: number
          created_at?: string | null
          expires_at?: string
          id?: string
          key?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      ss_sweepstakes_is_visible: { Args: { row_data: Json }; Returns: boolean }
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

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
