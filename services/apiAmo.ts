import 'dotenv/config';
import { Lead, noteType, Pipeline, Task } from '../interfaces';
import { DOMAIN } from '../modules/contants';

interface LinkData {
  to_entity_id: number;
  to_entity_type: string;
  metadata: {
    main_contact: boolean;
  } | null;
}

export class AmoAPI {
  private readonly token: string;
  private readonly domain: string;
  private readonly apiUrl: string;
  private readonly pipelinesUrl: string;

  constructor() {
    this.token = process.env.FETCH_API_TOKEN || '';
    this.domain = DOMAIN;
    this.apiUrl = `https://${this.domain}.amocrm.ru/api/v4/leads`;
    this.pipelinesUrl = `https://${this.domain}.amocrm.ru/api/v4/leads/pipelines`;
  }

  private getHeaders(): HeadersInit {
    return {
      Authorization: `Bearer ${this.token}`,
      'Content-Type': 'application/json',
    };
  }

  private async fetchWithAuth(
    url: string,
    options: RequestInit = {},
  ): Promise<Response> {
    const defaultOptions: RequestInit = {
      headers: this.getHeaders(),
      ...options,
    };

    const response = await fetch(url, defaultOptions);

    if (!response.ok && response.status !== 204) {
      throw new Error(`API Error: ${response.status} ${response.statusText}`);
    }

    return response;
  }

  async getNotesByLead(id: number): Promise<noteType[] | null> {
    const url = `https://${this.domain}.amocrm.ru/api/v4/leads/${id}/notes`;
    const response = await this.fetchWithAuth(url);

    if (response.status === 204) return null;

    const data: { _embedded: { notes: noteType[] } } = await response.json();
    return data._embedded?.notes || null;
  }

  async updateLeadDateCall(id: number, date: string): Promise<any> {
    const url = `https://${this.domain}.amocrm.ru/api/v4/leads/${id}`;
    const response = await this.fetchWithAuth(url, {
      method: 'PATCH',
      body: JSON.stringify({
        custom_fields_values: [
          {
            field_id: 607249, // ID поля "Первый исходящий"
            values: [{ value: date }],
          },
        ],
      }),
    });

    return response.json();
  }

  async getAllPipelines(): Promise<Pipeline[]> {
    const response = await this.fetchWithAuth(this.pipelinesUrl);
    const data = await response.json();
    return data._embedded.pipelines;
  }

  async getLeadsToday(
    startTimestamp: number,
    endTimestamp: number,
    page: number = 1,
    allLeads: Lead[] = [],
  ): Promise<Lead[]> {
    const limit = 250;
    const url = `${this.apiUrl}?filter[created_at][from]=${startTimestamp}&filter[created_at][to]=${endTimestamp}&page=${page}&limit=${limit}`;

    try {
      const response = await this.fetchWithAuth(url);
      const data = await response.json();
      const leads = data._embedded?.leads || [];

      const collectedLeads = [...allLeads, ...leads];

      if (leads.length === limit) {
        return this.getLeadsToday(
          startTimestamp,
          endTimestamp,
          page + 1,
          collectedLeads,
        );
      }

      return collectedLeads;
    } catch (error) {
      console.error('Ошибка при получении сделок:', error);
      throw error;
    }
  }

  async getLeadById(id: number): Promise<Lead | null> {
    const url = `${this.apiUrl}/${id}`;

    try {
      const response = await this.fetchWithAuth(url);

      if (response.status === 204) {
        return null;
      }

      const data = await response.json();
      return data;
    } catch (error) {
      console.error(`Error fetching lead ${id}:`, error);
      return null;
    }
  }

  async getContactsByIdLead(idLead: number): Promise<LinkData[]> {
    const url = `https://${this.domain}.amocrm.ru/api/v4/leads/${idLead}/links`;
    const response = await this.fetchWithAuth(url);
    const data = await response.json();
    return data._embedded.links;
  }

  async getNotesByIdContact(idContact: number): Promise<noteType[]> {
    const url = `https://${this.domain}.amocrm.ru/api/v4/contacts/${idContact}/notes`;
    const response = await this.fetchWithAuth(url);
    const data = await response.json();
    return data._embedded.notes;
  }

  async getTasks(idLead: number): Promise<Task[]> {
    const url = `https://${this.domain}.amocrm.ru/api/v4/tasks?filter[entity_type]=leads&filter[entity_id]=${idLead}`;
    const response = await this.fetchWithAuth(url);
    const data = await response.json();

    return data._embedded.tasks;
  }
}
