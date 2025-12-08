import 'dotenv/config';
import { IUser, Lead, noteType, Pipeline, Task } from '../interfaces';
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

  // Кэш пользователей
  private usersCache: Map<number, IUser> = new Map();
  private usersCacheTime: number = 0;
  private readonly CACHE_TTL = 30 * 60 * 1000; // 30 минут в миллисекундах
  private isCacheLoading: boolean = false;
  private cacheLoadPromise: Promise<void> | null = null;

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

  // Получение ВСЕХ пользователей с пагинацией
  async getAllUsers(): Promise<IUser[]> {
    try {
      const allUsers: IUser[] = [];
      let page = 1;
      const limit = 250; // Максимальное количество на странице
      let hasMore = true;
      const baseUrl = `https://${this.domain}.amocrm.ru/api/v4/users`;

      while (hasMore) {
        const url = `${baseUrl}?page=${page}&limit=${limit}`;
        const response = await this.fetchWithAuth(url);

        if (response.status === 204) {
          hasMore = false;
          continue;
        }

        const data = await response.json();
        const users: IUser[] = data._embedded?.users || [];

        if (users.length > 0) {
          allUsers.push(...users);
          page++;

          // Если получено меньше лимита, значит это последняя страница
          if (users.length < limit) {
            hasMore = false;
          }
        } else {
          hasMore = false;
        }

        // Небольшая задержка для избежания rate limiting
        if (hasMore) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }

      console.log(`✅ Получено ${allUsers.length} пользователей из amoCRM`);
      return allUsers;
    } catch (error) {
      console.error('❌ Ошибка получения пользователей:', error);
      throw error;
    }
  }

  // Загрузка пользователей в кэш (с защитой от параллельных вызовов)
  async loadUsersCache(): Promise<void> {
    // Если кэш уже загружается, ждем существующий промис
    if (this.isCacheLoading && this.cacheLoadPromise) {
      console.log('🔄 Кэш уже загружается, ждем...');
      return this.cacheLoadPromise;
    }

    // Защита от слишком частой перезагрузки (минимум 1 минута между обновлениями)
    const now = Date.now();
    if (this.isCacheValid() && now - this.usersCacheTime < 60 * 1000) {
      console.log('⏭️ Кэш еще актуален, пропускаем загрузку');
      return;
    }

    this.isCacheLoading = true;

    this.cacheLoadPromise = new Promise(async (resolve, reject) => {
      try {
        console.log('🔄 Загрузка пользователей в кэш...');

        const users = await this.getAllUsers();

        // Очищаем старый кэш
        this.usersCache.clear();

        // Заполняем кэш
        users.forEach((user) => {
          this.usersCache.set(user.id, user);
        });

        this.usersCacheTime = Date.now();
        this.isCacheLoading = false;
        this.cacheLoadPromise = null;

        console.log(`✅ Кэш обновлен: ${users.length} пользователей`);
        resolve();
      } catch (error) {
        this.isCacheLoading = false;
        this.cacheLoadPromise = null;
        console.error('❌ Ошибка загрузки кэша пользователей:', error);
        reject(error);
      }
    });

    return this.cacheLoadPromise;
  }

  // Получение пользователя из кэша
  getCachedUser(userId: number): IUser | null {
    const user = this.usersCache.get(userId);
    return user || null;
  }

  // Получение пользователя с проверкой кэша
  async getUser(userId: number): Promise<IUser | null> {
    // Если кэш устарел, обновляем его
    if (!this.isCacheValid()) {
      console.log('🔄 Кэш устарел, обновляем...');
      try {
        await this.loadUsersCache();
      } catch (error) {
        console.warn('Не удалось обновить кэш, используем старые данные');
      }
    }

    const user = this.getCachedUser(userId);

    if (!user) {
      console.warn(`⚠️ Пользователь с ID ${userId} не найден в кэше`);

      // Пробуем обновить кэш и поискать снова
      try {
        await this.loadUsersCache();
        return this.getCachedUser(userId);
      } catch (error) {
        return null;
      }
    }

    return user;
  }

  // Получение имени пользователя по ID (удобный метод)
  async getUserName(userId: number): Promise<string> {
    const user = await this.getUser(userId);
    return user?.name || `ID: ${userId}`;
  }

  // Инициализация кэша (вызывать при старте приложения)
  async initUsersCache(): Promise<void> {
    if (this.usersCache.size === 0) {
      await this.loadUsersCache();
    }
  }

  // Проверка актуальности кэша
  isCacheValid(): boolean {
    if (this.usersCache.size === 0) return false;

    const now = Date.now();
    return now - this.usersCacheTime <= this.CACHE_TTL;
  }

  // Очистка кэша
  clearUsersCache(): void {
    this.usersCache.clear();
    this.usersCacheTime = 0;
    console.log('🧹 Кэш пользователей очищен');
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
