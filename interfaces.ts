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
  omTakenAt: number;
  omTakenBy: string;
  omAssignedAt: number;
  omAssignedBy: string;
  custom_fields_values?: CustomFields[];
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
  note_type: 'call_out';
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
