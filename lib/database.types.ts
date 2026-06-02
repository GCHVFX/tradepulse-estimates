export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      tpe_businesses: {
        Row: {
          email: string | null
          google_review_link: string | null
          logo_url: string | null
          name: string
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
      tpe_estimates: {
        Row: {
          assumptions: string | null
          business_id: string | null
          completed_at: string | null
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
          review_requested_at: string | null
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
          created_at: string
          expires_at: string
          id: string
          key: string
        }
        Insert: {
          action: string
          count?: number
          created_at?: string
          expires_at: string
          id?: string
          key: string
        }
        Update: {
          action?: string
          count?: number
          created_at?: string
          expires_at?: string
          id?: string
          key?: string
        }
        Relationships: []
      }
    }
    Views: {}
    Functions: {}
    Enums: {}
    CompositeTypes: {}
  }
}

type PublicSchema = Database[Extract<keyof Database, "public">]

export type Tables<
  PublicTableNameOrOptions extends
    | keyof (PublicSchema["Tables"] & PublicSchema["Views"])
    | { schema: keyof Database },
  TableName extends PublicTableNameOrOptions extends { schema: keyof Database }
    ? keyof (Database[PublicTableNameOrOptions["schema"]]["Tables"] &
        Database[PublicTableNameOrOptions["schema"]]["Views"])
    : never = never
> = PublicTableNameOrOptions extends { schema: keyof Database }
  ? (Database[PublicTableNameOrOptions["schema"]]["Tables"] &
      Database[PublicTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : PublicTableNameOrOptions extends keyof (PublicSchema["Tables"] &
        PublicSchema["Views"])
    ? (PublicSchema["Tables"] &
        PublicSchema["Views"])[PublicTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  PublicTableNameOrOptions extends
    | keyof PublicSchema["Tables"]
    | { schema: keyof Database },
  TableName extends PublicTableNameOrOptions extends { schema: keyof Database }
    ? keyof Database[PublicTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = PublicTableNameOrOptions extends { schema: keyof Database }
  ? Database[PublicTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : PublicTableNameOrOptions extends keyof PublicSchema["Tables"]
    ? PublicSchema["Tables"][PublicTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  PublicTableNameOrOptions extends
    | keyof PublicSchema["Tables"]
    | { schema: keyof Database },
  TableName extends PublicTableNameOrOptions extends { schema: keyof Database }
    ? keyof Database[PublicTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = PublicTableNameOrOptions extends { schema: keyof Database }
  ? Database[PublicTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : PublicTableNameOrOptions extends keyof PublicSchema["Tables"]
    ? PublicSchema["Tables"][PublicTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  PublicEnumNameOrOptions extends
    | keyof PublicSchema["Enums"]
    | { schema: keyof Database },
  EnumName extends PublicEnumNameOrOptions extends { schema: keyof Database }
    ? keyof Database[PublicEnumNameOrOptions["schema"]]["Enums"]
    : never = never
> = PublicEnumNameOrOptions extends { schema: keyof Database }
  ? Database[PublicEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : PublicEnumNameOrOptions extends keyof PublicSchema["Enums"]
    ? PublicSchema["Enums"][PublicEnumNameOrOptions]
    : never