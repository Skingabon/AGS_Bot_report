export interface Pipeline {
  id: number;
  name: string;
}

export interface Lead {
  id: number;
  name: string;
  price: number;
  status_id: number;
  pipeline_id: number;
  created_at: number;
  updated_at: number;
  custom_fields_values?: CustomFields[];
  responsible_user_id: number;
}

export interface CustomFields {
  field_name: string;
  values: { value: string }[];
  field_id: number;
}

export type noteType = {
  id: number;
  entity_id: number;
  created_by: number;
  updated_by: number;
  created_at: number;
  updated_at: number;
  responsible_user_id: number;
  group_id: number;
  note_type: string;
  params: {
    thread_id: string;
    message_id: string;
    private: boolean;
    income: boolean;
    text: string;
    phone: string;
    link: string;
    from: {
      email: string;
      name: string;
    };
    to: {
      email: string;
      name: string;
    };
    subject: string;
    access_granted: number;
    content_summary: string;
    delivery: {
      status: string;
      time: number;
    };
    duration: number;
    call_status: number;
  };
  account_id: number;
  _links: {
    self: {
      href: string;
    };
  };
};

export interface noteTypeCall {
  id: number;
  entity_id: number;
  created_by: number;
  updated_by: number;
  created_at: number;
  updated_at: number;
  responsible_user_id: number;
  group_id: number;
  note_type: 'call_out' | 'call_in';
  params: {
    uniq: string;
    duration: number;
    source: string;
    link: string;
    phone: string;
    call_result: null;
    call_status: number;
  };
  account_id: number;
  _links: {
    self: {
      href: string;
    };
  };
}

type Note = noteTypeCall | noteType;

// Проверка на noteType (сообщение)
export function isMessageNote(note: Note): note is noteType {
  return note.note_type === 'amomail_message';
}

// Проверка на noteTypeCall (звонок)
export function isCallNote(note: Note): note is noteTypeCall {
  return note.note_type === 'call_out';
}

export interface Task {
  id: number;
  created_by: number;
  updated_by: number;
  created_at: number;
  updated_at: number;
  responsible_user_id: number;
  group_id: number;
  entity_id: number;
  entity_type: 'leads' | 'contacts' | 'companies' | 'customers';
  duration: number;
  is_completed: boolean;
  task_type_id: number;
  text: string;
  result: {
    id?: number;
    text: string;
  };
  complete_till: number;
  account_id: number;
  _links: {
    self: {
      href: string;
    };
  };
}

export interface IUser {
  id: number;
  name: string;
  email?: string;
  lang?: string;
  rights?: {
    is_admin: boolean;
    is_free: boolean;
    is_active: boolean;
  };
  group_id?: number;
  _links?: {
    self: {
      href: string;
    };
  };
}

// Базовые типы для всех событий
interface BaseEvent {
  id: string;
  type: string;
  entity_id: number;
  entity_type: string;
  created_by: number;
  created_at: number;
  account_id: number;
  _links: {
    self: {
      href: string;
    };
  };
  _embedded: {
    entity: {
      id: number;
      _links: {
        self: {
          href: string;
        };
      };
    };
  };
}

// Тип для события изменения статуса лида
export interface LeadStatusChangedEvent extends BaseEvent {
  type: 'lead_status_changed';
  value_after: Array<{
    lead_status: {
      id: number;
      pipeline_id: number;
    };
  }>;
  value_before: Array<{
    lead_status: {
      id: number;
      pipeline_id: number;
    };
  }>;
}

// Тип для события изменения ответственного
export interface LeadResponsibleChangedEvent extends BaseEvent {
  type: 'entity_responsible_changed';
  value_after: Array<{
    responsible_user: {
      id: number;
    };
  }>;
  value_before: Array<{
    responsible_user: {
      id: number;
    };
  }>;
}
