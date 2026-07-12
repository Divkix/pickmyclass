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
    PostgrestVersion: "13.0.5"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      class_states: {
        Row: {
          catalog_nbr: string
          class_nbr: string
          id: string
          instructor_name: string | null
          last_changed_at: string
          last_checked_at: string
          location: string | null
          meeting_times: string | null
          non_reserved_seats: number | null
          seats_available: number
          seats_capacity: number
          subject: string
          term: string
          title: string | null
        }
        Insert: {
          catalog_nbr: string
          class_nbr: string
          id?: string
          instructor_name?: string | null
          last_changed_at?: string
          last_checked_at?: string
          location?: string | null
          meeting_times?: string | null
          non_reserved_seats?: number | null
          seats_available?: number
          seats_capacity?: number
          subject: string
          term: string
          title?: string | null
        }
        Update: {
          catalog_nbr?: string
          class_nbr?: string
          id?: string
          instructor_name?: string | null
          last_changed_at?: string
          last_checked_at?: string
          location?: string | null
          meeting_times?: string | null
          non_reserved_seats?: number | null
          seats_available?: number
          seats_capacity?: number
          subject?: string
          term?: string
          title?: string | null
        }
        Relationships: []
      }
      class_watches: {
        Row: {
          catalog_nbr: string
          class_nbr: string
          created_at: string
          id: string
          subject: string
          term: string
          user_id: string
        }
        Insert: {
          catalog_nbr: string
          class_nbr: string
          created_at?: string
          id?: string
          subject: string
          term: string
          user_id: string
        }
        Update: {
          catalog_nbr?: string
          class_nbr?: string
          created_at?: string
          id?: string
          subject?: string
          term?: string
          user_id?: string
        }
        Relationships: []
      }
      failed_login_attempts: {
        Row: {
          attempts: number | null
          email: string
          last_attempt_at: string | null
          locked_until: string | null
        }
        Insert: {
          attempts?: number | null
          email: string
          last_attempt_at?: string | null
          locked_until?: string | null
        }
        Update: {
          attempts?: number | null
          email?: string
          last_attempt_at?: string | null
          locked_until?: string | null
        }
        Relationships: []
      }
      notifications_sent: {
        Row: {
          class_watch_id: string
          expires_at: string
          id: string
          is_active: boolean
          notification_type: string
          sent_at: string
        }
        Insert: {
          class_watch_id: string
          expires_at?: string
          id?: string
          is_active?: boolean
          notification_type: string
          sent_at?: string
        }
        Update: {
          class_watch_id?: string
          expires_at?: string
          id?: string
          is_active?: boolean
          notification_type?: string
          sent_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_sent_class_watch_id_fkey"
            columns: ["class_watch_id"]
            isOneToOne: false
            referencedRelation: "class_watches"
            referencedColumns: ["id"]
          },
        ]
      }
      user_profiles: {
        Row: {
          age_verified_at: string | null
          agreed_to_terms_at: string | null
          created_at: string
          disabled_at: string | null
          email_bounced: boolean
          email_bounced_at: string | null
          engagement_disabled_at: string | null
          engagement_emails_opened: number
          engagement_emails_sent: number
          engagement_last_opened_at: string | null
          engagement_window_start: string | null
          id: string
          is_admin: boolean
          is_disabled: boolean
          notifications_enabled: boolean
          onboarding_completed_at: string | null
          onboarding_skipped_at: string | null
          spam_complained: boolean
          spam_complained_at: string | null
          unsubscribed_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          age_verified_at?: string | null
          agreed_to_terms_at?: string | null
          created_at?: string
          disabled_at?: string | null
          email_bounced?: boolean
          email_bounced_at?: string | null
          engagement_disabled_at?: string | null
          engagement_emails_opened?: number
          engagement_emails_sent?: number
          engagement_last_opened_at?: string | null
          engagement_window_start?: string | null
          id?: string
          is_admin?: boolean
          is_disabled?: boolean
          notifications_enabled?: boolean
          onboarding_completed_at?: string | null
          onboarding_skipped_at?: string | null
          spam_complained?: boolean
          spam_complained_at?: string | null
          unsubscribed_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          age_verified_at?: string | null
          agreed_to_terms_at?: string | null
          created_at?: string
          disabled_at?: string | null
          email_bounced?: boolean
          email_bounced_at?: string | null
          engagement_disabled_at?: string | null
          engagement_emails_opened?: number
          engagement_emails_sent?: number
          engagement_last_opened_at?: string | null
          engagement_window_start?: string | null
          id?: string
          is_admin?: boolean
          is_disabled?: boolean
          notifications_enabled?: boolean
          onboarding_completed_at?: string | null
          onboarding_skipped_at?: string | null
          spam_complained?: boolean
          spam_complained_at?: string | null
          unsubscribed_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accept_terms_and_verify_age: { Args: never; Returns: undefined }
      count_all_users: { Args: never; Returns: number }
      count_distinct_classes_watched: { Args: never; Returns: number }
      create_class_watch_with_limit: {
        Args: {
          p_catalog_nbr: string
          p_class_nbr: string
          p_max_watches: number
          p_subject: string
          p_term: string
          p_user_id: string
        }
        Returns: {
          catalog_nbr: string
          class_nbr: string
          created_at: string
          id: string
          subject: string
          term: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "class_watches"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      delete_notification_records: {
        Args: { p_class_watch_ids: string[]; p_notification_type: string }
        Returns: number
      }
      expire_stale_notifications: { Args: never; Returns: number }
      get_class_watchers: {
        Args: { p_class_nbr: string; p_term: string }
        Returns: {
          created_at: string
          email: string
          user_id: string
          watch_id: string
        }[]
      }
      get_classes_page: {
        Args: {
          p_dir?: string
          p_instructor?: string
          p_page?: number
          p_page_size?: number
          p_search?: string
          p_seat_status?: string
          p_sort?: string
          p_subject?: string
          p_watcher_count?: string
        }
        Returns: {
          catalog_nbr: string
          class_nbr: string
          id: string
          instructor_emails: number
          instructor_name: string
          last_changed_at: string
          last_checked_at: string
          location: string
          meeting_times: string
          non_reserved_seats: number
          seat_emails: number
          seats_available: number
          seats_capacity: number
          subject: string
          term: string
          title: string
          total_count: number
          watcher_count: number
        }[]
      }
      get_distinct_subjects: {
        Args: never
        Returns: {
          subject: string
        }[]
      }
      get_most_watched_class: {
        Args: { p_term: string }
        Returns: {
          class_nbr: string
          term: string
        }[]
      }
      get_notification_counts_by_class: {
        Args: never
        Returns: {
          class_nbr: string
          instructor_emails: number
          seat_emails: number
        }[]
      }
      get_notification_counts_by_user: {
        Args: never
        Returns: {
          instructor_emails: number
          seat_emails: number
          user_id: string
        }[]
      }
      get_recent_activity: {
        Args: { p_limit?: number }
        Returns: {
          activity_at: string
          activity_type: string
          catalog_nbr: string
          class_nbr: string
          notification_type: string
          subject: string
          user_email: string
        }[]
      }
      get_sections_to_check: {
        Args: { stagger_type: string }
        Returns: {
          class_nbr: string
          term: string
        }[]
      }
      get_user_engagement_stats: {
        Args: never
        Returns: {
          engagement_emails_opened: number
          engagement_emails_sent: number
          engagement_rate: number
          engagement_status: string
          user_id: string
        }[]
      }
      get_users_page: {
        Args: {
          p_dir?: string
          p_page?: number
          p_page_size?: number
          p_role?: string
          p_search?: string
          p_sort?: string
          p_verified?: string
          p_watch_count?: string
        }
        Returns: {
          created_at: string
          email: string
          email_confirmed_at: string
          engagement_emails_opened: number
          engagement_emails_sent: number
          engagement_rate: number
          engagement_status: string
          id: string
          instructor_emails: number
          is_admin: boolean
          last_sign_in_at: string
          seat_emails: number
          total_count: number
          watch_count: number
        }[]
      }
      get_watchers_for_sections: {
        Args: { section_numbers: string[]; p_term: string }
        Returns: {
          class_nbr: string
          email: string
          user_id: string
          watch_id: string
        }[]
      }
      increment_failed_attempts: {
        Args: {
          p_email: string
          p_lockout_minutes?: number
          p_max_attempts?: number
        }
        Returns: {
          attempts: number
          locked: boolean
        }[]
      }
      record_engagement_open: {
        Args: { p_user_id: string }
        Returns: undefined
      }
      record_engagement_send: { Args: { p_user_id: string }; Returns: boolean }
      record_engagement_send_batch: {
        Args: { p_user_ids: string[] }
        Returns: undefined
      }
      skip_onboarding: {
        Args: Record<PropertyKey, never>
        Returns: {
          onboarding_completed_at: string | null
          onboarding_skipped_at: string | null
        }[]
      }
      try_record_notification: {
        Args: {
          p_class_watch_id: string
          p_expires_hours?: number
          p_notification_type: string
        }
        Returns: boolean
      }
      try_record_notifications_batch: {
        Args: {
          p_class_watch_ids: string[]
          p_expires_hours?: number
          p_notification_type: string
        }
        Returns: string[]
      }
      user_owns_class_watch: { Args: { watch_id: string }; Returns: boolean }
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const
