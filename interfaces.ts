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