export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: "13.0.4"
  }
  public: {
    Tables: {
      tpe_businesses: {
        Row: {
          created_at: string
          deposit_percent: number | null
          deposit_threshold: number | null
          email: string | null
          google_review_link: string | null
          id: string
          labour_rate: number
          logo_url: string | null
          markup_percent: number
          name: string
          owner_user_id: string | null
          payment_link: string | null
          phone: string | null
          plan: string
          prepared_by: string
          signup_source: string | null
          slug: string
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          subscription_status: string
          tax_label: string
          tax_rate: number
          trial_ends_at: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          deposit_percent?: number | null
          deposit_threshold?: number | null
          email?: string | null
          google_review_link?: string | null
          id?: string
          labour_rate?: number
          logo_url?: string | null
          markup_percent?: number
          name: string
          owner_user_id?: string | null
          payment_link?: string | null
          phone?: string | null
          plan?: string
          prepared_by?: string
          signup_source?: string | null
          slug: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          subscription_status?: string
          tax_label?: string
          tax_rate?: number
          trial_ends_at?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          deposit_percent?: number | null
          deposit_threshold?: number | null
          email?: string | null
          google_review_link?: string | null
          id?: string
          labour_rate?: number
          logo_url?: string | null
          markup_percent?: number
          name?: string
          owner_user_id?: string | null
          payment_link?: string | null
          phone?: string | null
          plan?: string
          prepared_by?: string
          signup_source?: string | null
          slug?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          subscription_status?: string
          tax_label?: string
          tax_rate?: number
          trial_ends_at?: string | null
          updated_at?: string
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
          user_id: string | null
        }
        Insert: {
          change_type: string
          changed_at?: string | null
          created_at?: string | null
          estimate_id: string
          id?: string
          new_value?: Json | null
          old_value?: Json | null
          user_id?: string | null
        }
        Update: {
          change_type?: string
          changed_at?: string | null
          created_at?: string | null
          estimate_id?: string
          id?: string
          new_value?: Json | null
          old_value?: Json | null
          user_id?: string | null
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
      tpe_estimate_line_items: {
        Row: {
          created_at: string
          description: string | null
          estimate_id: string
          id: string
          labour_price: number
          material_price: number
          name: string
          pricebook_item_id: string | null
          quantity: number
          sort_order: number
          taxable: boolean
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          estimate_id: string
          id?: string
          labour_price?: number
          material_price?: number
          name: string
          pricebook_item_id?: string | null
          quantity?: number
          sort_order?: number
          taxable?: boolean
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          estimate_id?: string
          id?: string
          labour_price?: number
          material_price?: number
          name?: string
          pricebook_item_id?: string | null
          quantity?: number
          sort_order?: number
          taxable?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tpe_estimate_line_items_estimate_id_fkey"
            columns: ["estimate_id"]
            isOneToOne: false
            referencedRelation: "tpe_estimates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tpe_estimate_line_items_pricebook_item_id_fkey"
            columns: ["pricebook_item_id"]
            isOneToOne: false
            referencedRelation: "tpe_pricebook_items"
            referencedColumns: ["id"]
          },
        ]
      }
      tpe_estimate_photos: {
        Row: {
          created_at: string
          estimate_id: string
          file_size: number
          id: string
          mime_type: string
          original_filename: string
          storage_path: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          estimate_id: string
          file_size: number
          id?: string
          mime_type: string
          original_filename: string
          storage_path: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          estimate_id?: string
          file_size?: number
          id?: string
          mime_type?: string
          original_filename?: string
          storage_path?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tpe_estimate_photos_estimate_id_fkey"
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
          business_id: string
          completed_at: string | null
          copied_at: string | null
          created_at: string
          customer_email: string
          customer_name: string
          customer_phone: string
          deposit_amount: string | null
          description: string
          due_date: string | null
          id: string
          include_photos: boolean
          invoice_amount: number | null
          job_address: string
          last_reminder_sent_at: string | null
          location: string
          notes: string | null
          payment_status: string | null
          payment_terms: string | null
          prepared_by: string
          reminder_count: number
          review_requested_at: string | null
          scope: string | null
          sent_at: string | null
          sent_via: string | null
          service_type: string
          source: string
          status: string
          summary: string | null
          title: string | null
          updated_at: string
          urgency: string
        }
        Insert: {
          assumptions?: string | null
          business_id: string
          completed_at?: string | null
          copied_at?: string | null
          created_at?: string
          customer_email: string
          customer_name: string
          customer_phone: string
          deposit_amount?: string | null
          description: string
          due_date?: string | null
          id?: string
          include_photos?: boolean
          invoice_amount?: number | null
          job_address: string
          last_reminder_sent_at?: string | null
          location: string
          notes?: string | null
          payment_status?: string | null
          payment_terms?: string | null
          prepared_by?: string
          reminder_count?: number
          review_requested_at?: string | null
          scope?: string | null
          sent_at?: string | null
          sent_via?: string | null
          service_type: string
          source?: string
          status?: string
          summary?: string | null
          title?: string | null
          updated_at?: string
          urgency: string
        }
        Update: {
          assumptions?: string | null
          business_id?: string
          completed_at?: string | null
          copied_at?: string | null
          created_at?: string
          customer_email?: string
          customer_name?: string
          customer_phone?: string
          deposit_amount?: string | null
          description?: string
          due_date?: string | null
          id?: string
          include_photos?: boolean
          invoice_amount?: number | null
          job_address?: string
          last_reminder_sent_at?: string | null
          location?: string
          notes?: string | null
          payment_status?: string | null
          payment_terms?: string | null
          prepared_by?: string
          reminder_count?: number
          review_requested_at?: string | null
          scope?: string | null
          sent_at?: string | null
          sent_via?: string | null
          service_type?: string
          source?: string
          status?: string
          summary?: string | null
          title?: string | null
          updated_at?: string
          urgency?: string
        }
        Relationships: [
          {
            foreignKeyName: "tpe_estimates_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "tpe_businesses"
            referencedColumns: ["id"]
          },
        ]
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
            foreignKeyName: "tpe_payment_reminders_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "tpe_businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tpe_payment_reminders_estimate_id_fkey"
            columns: ["estimate_id"]
            isOneToOne: false
            referencedRelation: "tpe_estimates"
            referencedColumns: ["id"]
          },
        ]
      }
      tpe_pricebook_items: {
        Row: {
          active: boolean
          business_id: string
          category: string
          created_at: string
          description: string | null
          id: string
          labour_price: number
          material_price: number
          name: string
          taxable: boolean
          updated_at: string
        }
        Insert: {
          active?: boolean
          business_id: string
          category: string
          created_at?: string
          description?: string | null
          id?: string
          labour_price?: number
          material_price?: number
          name: string
          taxable?: boolean
          updated_at?: string
        }
        Update: {
          active?: boolean
          business_id?: string
          category?: string
          created_at?: string
          description?: string | null
          id?: string
          labour_price?: number
          material_price?: number
          name?: string
          taxable?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tpe_pricebook_items_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "tpe_businesses"
            referencedColumns: ["id"]
          },
        ]
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
      increment_rate_limit: {
        Args: {
          p_key: string
          p_action: string
        }
        Returns: {
          new_count: number
          window_expires_at: string
        }[]
      }
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
