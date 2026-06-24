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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      activities: {
        Row: {
          contact_id: string | null
          created_at: string
          deal_id: string | null
          description: string | null
          duration_minutes: number | null
          id: string
          lead_id: string | null
          occurred_at: string | null
          subject: string
          type: string
          user_id: string
        }
        Insert: {
          contact_id?: string | null
          created_at?: string
          deal_id?: string | null
          description?: string | null
          duration_minutes?: number | null
          id?: string
          lead_id?: string | null
          occurred_at?: string | null
          subject: string
          type: string
          user_id: string
        }
        Update: {
          contact_id?: string | null
          created_at?: string
          deal_id?: string | null
          description?: string | null
          duration_minutes?: number | null
          id?: string
          lead_id?: string | null
          occurred_at?: string | null
          subject?: string
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "activities_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activities_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activities_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      batches: {
        Row: {
          course_id: string | null
          created_at: string
          end_date: string | null
          id: string
          name: string
          seat_limit: number | null
          start_date: string | null
          status: string | null
          trainer_id: string | null
          updated_at: string
        }
        Insert: {
          course_id?: string | null
          created_at?: string
          end_date?: string | null
          id?: string
          name: string
          seat_limit?: number | null
          start_date?: string | null
          status?: string | null
          trainer_id?: string | null
          updated_at?: string
        }
        Update: {
          course_id?: string | null
          created_at?: string
          end_date?: string | null
          id?: string
          name?: string
          seat_limit?: number | null
          start_date?: string | null
          status?: string | null
          trainer_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "batches_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
        ]
      }
      contacts: {
        Row: {
          company: string | null
          created_at: string
          email: string | null
          id: string
          lead_id: string | null
          name: string
          notes: string | null
          owner_id: string | null
          phone: string | null
          position: string | null
          tags: string[] | null
          updated_at: string
        }
        Insert: {
          company?: string | null
          created_at?: string
          email?: string | null
          id?: string
          lead_id?: string | null
          name: string
          notes?: string | null
          owner_id?: string | null
          phone?: string | null
          position?: string | null
          tags?: string[] | null
          updated_at?: string
        }
        Update: {
          company?: string | null
          created_at?: string
          email?: string | null
          id?: string
          lead_id?: string | null
          name?: string
          notes?: string | null
          owner_id?: string | null
          phone?: string | null
          position?: string | null
          tags?: string[] | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "contacts_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      courses: {
        Row: {
          created_at: string
          description: string | null
          duration_weeks: number | null
          id: string
          is_active: boolean | null
          modules: Json | null
          name: string
          price: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          duration_weeks?: number | null
          id?: string
          is_active?: boolean | null
          modules?: Json | null
          name: string
          price?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          duration_weeks?: number | null
          id?: string
          is_active?: boolean | null
          modules?: Json | null
          name?: string
          price?: number
          updated_at?: string
        }
        Relationships: []
      }
      deals: {
        Row: {
          contact_id: string | null
          created_at: string
          description: string | null
          expected_close_date: string | null
          id: string
          owner_id: string | null
          probability: number | null
          stage_id: string | null
          status: string | null
          title: string
          updated_at: string
          value: number | null
        }
        Insert: {
          contact_id?: string | null
          created_at?: string
          description?: string | null
          expected_close_date?: string | null
          id?: string
          owner_id?: string | null
          probability?: number | null
          stage_id?: string | null
          status?: string | null
          title: string
          updated_at?: string
          value?: number | null
        }
        Update: {
          contact_id?: string | null
          created_at?: string
          description?: string | null
          expected_close_date?: string | null
          id?: string
          owner_id?: string | null
          probability?: number | null
          stage_id?: string | null
          status?: string | null
          title?: string
          updated_at?: string
          value?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "deals_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deals_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "pipeline_stages"
            referencedColumns: ["id"]
          },
        ]
      }
      email_campaigns: {
        Row: {
          created_at: string
          created_by: string
          draft_id: string | null
          failed_count: number
          id: string
          pending_count: number
          recipient_count: number
          sent_count: number
          status: string
          subject: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          draft_id?: string | null
          failed_count?: number
          id?: string
          pending_count?: number
          recipient_count?: number
          sent_count?: number
          status?: string
          subject: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          draft_id?: string | null
          failed_count?: number
          id?: string
          pending_count?: number
          recipient_count?: number
          sent_count?: number
          status?: string
          subject?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_campaigns_draft_id_fkey"
            columns: ["draft_id"]
            isOneToOne: false
            referencedRelation: "email_drafts"
            referencedColumns: ["id"]
          },
        ]
      }
      email_drafts: {
        Row: {
          created_at: string
          created_by: string
          html_body: string
          id: string
          name: string
          plain_text: string | null
          status: string
          subject: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          html_body?: string
          id?: string
          name?: string
          plain_text?: string | null
          status?: string
          subject?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          html_body?: string
          id?: string
          name?: string
          plain_text?: string | null
          status?: string
          subject?: string
          updated_at?: string
        }
        Relationships: []
      }
      email_sends: {
        Row: {
          campaign_id: string
          created_at: string
          error_message: string | null
          id: string
          recipient_email: string
          sent_at: string | null
          status: string
        }
        Insert: {
          campaign_id: string
          created_at?: string
          error_message?: string | null
          id?: string
          recipient_email: string
          sent_at?: string | null
          status?: string
        }
        Update: {
          campaign_id?: string
          created_at?: string
          error_message?: string | null
          id?: string
          recipient_email?: string
          sent_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_sends_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "email_campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      holidays: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          created_at: string
          date: string
          id: string
          is_approved: boolean
          name: string
          notes: string | null
          type: string
          updated_at: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          date: string
          id?: string
          is_approved?: boolean
          name: string
          notes?: string | null
          type?: string
          updated_at?: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          date?: string
          id?: string
          is_approved?: boolean
          name?: string
          notes?: string | null
          type?: string
          updated_at?: string
        }
        Relationships: []
      }
      lead_activities: {
        Row: {
          completed_at: string | null
          created_at: string
          description: string | null
          id: string
          lead_id: string
          scheduled_at: string | null
          type: string
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          description?: string | null
          id?: string
          lead_id: string
          scheduled_at?: string | null
          type: string
          user_id: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          description?: string | null
          id?: string
          lead_id?: string
          scheduled_at?: string | null
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_activities_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_assignments: {
        Row: {
          created_at: string
          id: string
          lead_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          lead_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          lead_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_assignments_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      leads: {
        Row: {
          assigned_to: string | null
          college: string | null
          company: string | null
          course_interest: string | null
          created_at: string
          email: string | null
          id: string
          name: string
          next_follow_up: string | null
          notes: string | null
          resume_path: string | null
          phone: string | null
          referred_by: string | null
          score: number | null
          source: Database["public"]["Enums"]["lead_source"] | null
          status: Database["public"]["Enums"]["lead_status"] | null
          tags: string[] | null
          updated_at: string
          year_of_study: string | null
        }
        Insert: {
          assigned_to?: string | null
          college?: string | null
          company?: string | null
          course_interest?: string | null
          created_at?: string
          email?: string | null
          id?: string
          name: string
          next_follow_up?: string | null
          notes?: string | null
          resume_path?: string | null
          phone?: string | null
          referred_by?: string | null
          score?: number | null
          source?: Database["public"]["Enums"]["lead_source"] | null
          status?: Database["public"]["Enums"]["lead_status"] | null
          tags?: string[] | null
          updated_at?: string
          year_of_study?: string | null
        }
        Update: {
          assigned_to?: string | null
          college?: string | null
          company?: string | null
          course_interest?: string | null
          created_at?: string
          email?: string | null
          id?: string
          name?: string
          next_follow_up?: string | null
          notes?: string | null
          resume_path?: string | null
          phone?: string | null
          referred_by?: string | null
          score?: number | null
          source?: Database["public"]["Enums"]["lead_source"] | null
          status?: Database["public"]["Enums"]["lead_status"] | null
          tags?: string[] | null
          updated_at?: string
          year_of_study?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "leads_course_interest_fkey"
            columns: ["course_interest"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
        ]
      }
      marketing_members: {
        Row: {
          created_at: string
          created_by: string | null
          email: string
          id: string
          name: string
          phone: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          email: string
          id?: string
          name: string
          phone?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          email?: string
          id?: string
          name?: string
          phone?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          created_at: string
          id: string
          is_read: boolean
          link: string | null
          message: string | null
          title: string
          type: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_read?: boolean
          link?: string | null
          message?: string | null
          title: string
          type?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_read?: boolean
          link?: string | null
          message?: string | null
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: []
      }
      offer_letter_templates: {
        Row: {
          created_at: string
          created_by: string
          html_content: string
          id: string
          role_title: string
          status: string
          template_name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          html_content?: string
          id?: string
          role_title: string
          status?: string
          template_name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          html_content?: string
          id?: string
          role_title?: string
          status?: string
          template_name?: string
          updated_at?: string
        }
        Relationships: []
      }
      offer_letters_sent: {
        Row: {
          created_at: string
          html_content: string
          id: string
          pdf_url: string | null
          recipient_email: string
          recipient_name: string
          role_title: string
          sent_at: string
          sent_by: string
          status: string
          template_id: string | null
        }
        Insert: {
          created_at?: string
          html_content: string
          id?: string
          pdf_url?: string | null
          recipient_email: string
          recipient_name: string
          role_title: string
          sent_at?: string
          sent_by: string
          status?: string
          template_id?: string | null
        }
        Update: {
          created_at?: string
          html_content?: string
          id?: string
          pdf_url?: string | null
          recipient_email?: string
          recipient_name?: string
          role_title?: string
          sent_at?: string
          sent_by?: string
          status?: string
          template_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "offer_letters_sent_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "offer_letter_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          amount: number
          created_at: string
          due_date: string | null
          id: string
          notes: string | null
          paid_date: string | null
          payment_method: string | null
          payment_type: string
          status: string | null
          student_id: string
          updated_at: string
        }
        Insert: {
          amount: number
          created_at?: string
          due_date?: string | null
          id?: string
          notes?: string | null
          paid_date?: string | null
          payment_method?: string | null
          payment_type: string
          status?: string | null
          student_id: string
          updated_at?: string
        }
        Update: {
          amount?: number
          created_at?: string
          due_date?: string | null
          id?: string
          notes?: string | null
          paid_date?: string | null
          payment_method?: string | null
          payment_type?: string
          status?: string | null
          student_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payments_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      pipeline_stages: {
        Row: {
          color: string | null
          created_at: string
          id: string
          is_default: boolean | null
          name: string
          position: number
        }
        Insert: {
          color?: string | null
          created_at?: string
          id?: string
          is_default?: boolean | null
          name: string
          position?: number
        }
        Update: {
          color?: string | null
          created_at?: string
          id?: string
          is_default?: boolean | null
          name?: string
          position?: number
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          email: string
          full_name: string
          id: string
          phone: string | null
          referral_code: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email?: string
          full_name?: string
          id?: string
          phone?: string | null
          referral_code?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string
          full_name?: string
          id?: string
          phone?: string | null
          referral_code?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      students: {
        Row: {
          batch_id: string | null
          college: string | null
          course_id: string | null
          created_at: string
          email: string
          enrollment_date: string | null
          id: string
          lead_id: string | null
          mentor_id: string | null
          name: string
          phone: string | null
          status: string | null
          updated_at: string
          user_id: string | null
          year_of_study: string | null
        }
        Insert: {
          batch_id?: string | null
          college?: string | null
          course_id?: string | null
          created_at?: string
          email: string
          enrollment_date?: string | null
          id?: string
          lead_id?: string | null
          mentor_id?: string | null
          name: string
          phone?: string | null
          status?: string | null
          updated_at?: string
          user_id?: string | null
          year_of_study?: string | null
        }
        Update: {
          batch_id?: string | null
          college?: string | null
          course_id?: string | null
          created_at?: string
          email?: string
          enrollment_date?: string | null
          id?: string
          lead_id?: string | null
          mentor_id?: string | null
          name?: string
          phone?: string | null
          status?: string | null
          updated_at?: string
          user_id?: string | null
          year_of_study?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "students_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "students_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "students_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          assigned_to: string | null
          contact_id: string | null
          created_at: string
          created_by: string | null
          deal_id: string | null
          description: string | null
          due_date: string | null
          id: string
          lead_id: string | null
          priority: string | null
          status: string | null
          title: string
          updated_at: string
        }
        Insert: {
          assigned_to?: string | null
          contact_id?: string | null
          created_at?: string
          created_by?: string | null
          deal_id?: string | null
          description?: string | null
          due_date?: string | null
          id?: string
          lead_id?: string | null
          priority?: string | null
          status?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          assigned_to?: string | null
          contact_id?: string | null
          created_at?: string
          created_by?: string | null
          deal_id?: string | null
          description?: string | null
          due_date?: string | null
          id?: string
          lead_id?: string | null
          priority?: string | null
          status?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      whatsapp_campaigns: {
        Row: {
          created_at: string
          created_by: string
          draft_id: string | null
          failed_count: number
          id: string
          pending_count: number
          recipient_count: number
          sent_count: number
          status: string
          subject: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          draft_id?: string | null
          failed_count?: number
          id?: string
          pending_count?: number
          recipient_count?: number
          sent_count?: number
          status?: string
          subject: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          draft_id?: string | null
          failed_count?: number
          id?: string
          pending_count?: number
          recipient_count?: number
          sent_count?: number
          status?: string
          subject?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_campaigns_draft_id_fkey"
            columns: ["draft_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_drafts"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_drafts: {
        Row: {
          body: string
          created_at: string
          created_by: string
          id: string
          name: string
          status: string
          subject: string
          updated_at: string
        }
        Insert: {
          body?: string
          created_at?: string
          created_by: string
          id?: string
          name?: string
          status?: string
          subject?: string
          updated_at?: string
        }
        Update: {
          body?: string
          created_at?: string
          created_by?: string
          id?: string
          name?: string
          status?: string
          subject?: string
          updated_at?: string
        }
        Relationships: []
      }
      whatsapp_sends: {
        Row: {
          campaign_id: string
          created_at: string
          error_message: string | null
          id: string
          recipient_phone: string
          sent_at: string | null
          status: string
        }
        Insert: {
          campaign_id: string
          created_at?: string
          error_message?: string | null
          id?: string
          recipient_phone: string
          sent_at?: string | null
          status?: string
        }
        Update: {
          campaign_id?: string
          created_at?: string
          error_message?: string | null
          id?: string
          recipient_phone?: string
          sent_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_sends_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      get_user_role: {
        Args: { _user_id: string }
        Returns: Database["public"]["Enums"]["app_role"]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_referred_by_user: {
        Args: { _referred_by: string; _user_id: string }
        Returns: boolean
      }
    }
    Enums: {
      app_role:
        | "super_admin"
        | "admin"
        | "manager"
        | "trainer"
        | "student"
        | "finance"
        | "sales_representative"
        | "marketing"
      lead_source:
        | "google_ads"
        | "instagram"
        | "facebook"
        | "youtube"
        | "website"
        | "google_forms"
        | "whatsapp"
        | "referral"
        | "walkin"
        | "college_seminar"
        | "other"
      lead_status:
        | "new"
        | "contacted"
        | "qualified"
        | "interested"
        | "demo_scheduled"
        | "demo_attended"
        | "enrolled"
        | "lost"
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
    Enums: {
      app_role: [
        "super_admin",
        "admin",
        "manager",
        "trainer",
        "student",
        "finance",
        "sales_representative",
        "marketing",
      ],
      lead_source: [
        "google_ads",
        "instagram",
        "facebook",
        "youtube",
        "website",
        "google_forms",
        "whatsapp",
        "referral",
        "walkin",
        "college_seminar",
        "other",
      ],
      lead_status: [
        "new",
        "contacted",
        "qualified",
        "interested",
        "demo_scheduled",
        "demo_attended",
        "enrolled",
        "lost",
      ],
    },
  },
} as const
