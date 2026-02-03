import 'dotenv/config';
import {
  IUser,
  Lead,
  LeadResponsibleChangedEvent,
  LeadStatusChangedEvent,
  noteType,
  Pipeline,
  Task,
} from '../interfaces';
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
  private readonly baseUrl: string;

  // Кэш пользователей
  private usersCache: Map<number, IUser> = new Map();
  private usersCacheTime: number = 0;
  private readonly CACHE_TTL = 30 * 60 * 1000; // 30 минут в миллисекундах
  private isCacheLoading: boolean = false;
  private cacheLoadPromise: Promise<void> | null = null;

  // Конфигурация повторных попыток
  private readonly MAX_RETRIES = 3;
  private readonly INITIAL_DELAY = 1000; // 1 секунда
  private readonly MAX_DELAY = 10000; // 10 секунд

  constructor() {
    this.token = process.env.FETCH_API_TOKEN || '';
    this.domain = DOMAIN;
    this.baseUrl = `https://${this.domain}.amocrm.ru/api/v4`;
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
    retryConfig?: { maxRetries?: number; initialDelay?: number },
  ): Promise<Response> {
    const maxRetries = retryConfig?.maxRetries ?? this.MAX_RETRIES;
    const initialDelay = retryConfig?.initialDelay ?? this.INITIAL_DELAY;

    return this.withRetry(
      async () => {
        const defaultOptions: RequestInit = {
          headers: this.getHeaders(),
          ...options,
        };

        const response = await fetch(url, defaultOptions);

        if (!response.ok && response.status !== 204) {
          throw new Error(
            `API Error: ${response.status} ${response.statusText}`,
          );
        }

        return response;
      },
      maxRetries,
      initialDelay,
      `fetchWithAuth: ${url}`,
    );
  }

  /**
   * Универсальная функция для повторных попыток
   * @param operation Функция для выполнения
   * @param maxRetries Максимальное количество попыток
   * @param initialDelay Начальная задержка в мс
   * @param operationName Название операции для логирования
   * @returns Результат операции
   */
  private async withRetry<T>(
    operation: () => Promise<T>,
    maxRetries: number = this.MAX_RETRIES,
    initialDelay: number = this.INITIAL_DELAY,
    operationName: string = 'Unknown operation',
  ): Promise<T> {
    let lastError: any;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        if (attempt > 1) {
          console.log(
            `🔄 ${operationName}: Попытка ${attempt} из ${maxRetries}`,
          );
        }

        return await operation();
      } catch (error: any) {
        lastError = error;

        // Проверяем, стоит ли повторять запрос
        if (!this.shouldRetry(error) || attempt === maxRetries) {
          break;
        }

        // Рассчитываем экспоненциальную задержку с джиттером
        const delay = Math.min(
          initialDelay * Math.pow(2, attempt - 1) * (0.8 + Math.random() * 0.4),
          this.MAX_DELAY,
        );

        console.log(`⏳ ${operationName}: Повтор через ${Math.round(delay)}мс`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    console.error(
      `❌ ${operationName}: Все попытки исчерпаны после ${maxRetries} попыток`,
    );
    throw lastError;
  }

  /**
   * Определяет, стоит ли повторять запрос на основе ошибки
   * @param error Ошибка
   * @returns true если нужно повторить
   */
  private shouldRetry(error: any): boolean {
    // Сетевые ошибки
    if (error.name === 'TypeError' && error.message.includes('fetch failed')) {
      return true;
    }

    // Ошибки сокетов
    if (error.cause?.code === 'UND_ERR_SOCKET') {
      return true;
    }

    // Таймауты
    if (error.name === 'AbortError') {
      return true;
    }

    // Ошибки 5xx
    if (error.message?.includes('5')) {
      return true;
    }

    // Ошибки 429 (Too Many Requests)
    if (error.message?.includes('429')) {
      return true;
    }

    return false;
  }

  // Получение ВСЕХ пользователей с пагинацией
  async getAllUsers(): Promise<IUser[]> {
    return this.withRetry(
      async () => {
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
      },
      this.MAX_RETRIES,
      this.INITIAL_DELAY,
      'getAllUsers',
    );
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
        console.log('Заполняем кэш');
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
    return this.withRetry(
      async () => {
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
      },
      this.MAX_RETRIES,
      this.INITIAL_DELAY,
      `getUser: ${userId}`,
    );
  }

  // Получение имени пользователя по ID (удобный метод)
  async getUserName(userId: number): Promise<string> {
    return this.withRetry(
      async () => {
        const user = await this.getUser(userId);
        return user?.name || `ID: ${userId}`;
      },
      this.MAX_RETRIES,
      this.INITIAL_DELAY,
      `getUserName: ${userId}`,
    );
  }

  // Инициализация кэша (вызывать при старте приложения)
  async initUsersCache(): Promise<void> {
    return this.withRetry(
      async () => {
        if (this.usersCache.size === 0) {
          await this.loadUsersCache();
        }
      },
      this.MAX_RETRIES,
      this.INITIAL_DELAY,
      'initUsersCache',
    );
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
    return this.withRetry(
      async () => {
        const url = `https://${this.domain}.amocrm.ru/api/v4/leads/${id}/notes`;
        const response = await this.fetchWithAuth(url);

        if (response.status === 204) return null;

        const data: { _embedded: { notes: noteType[] } } =
          await response.json();
        return data._embedded?.notes || null;
      },
      this.MAX_RETRIES,
      this.INITIAL_DELAY,
      `getNotesByLead: ${id}`,
    );
  }

  async updateLeadDateCall(id: number, date: string): Promise<any> {
    return this.withRetry(
      async () => {
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
      },
      this.MAX_RETRIES,
      this.INITIAL_DELAY,
      `updateLeadDateCall: ${id}`,
    );
  }

  async getAllPipelines(): Promise<Pipeline[]> {
    return this.withRetry(
      async () => {
        const response = await this.fetchWithAuth(this.pipelinesUrl);
        const data = await response.json();
        return data._embedded.pipelines;
      },
      this.MAX_RETRIES,
      this.INITIAL_DELAY,
      'getAllPipelines',
    );
  }

  // Возвращает "id Воронки": 'Воронка'
  async getPipelinesName() {
    return this.withRetry(
      async () => {
        const pipelines = await new AmoAPI().getAllPipelines();
        return pipelines.reduce(
          (
            acc: { [key: number]: string },
            pipeline: { id: number; name: string },
          ) => {
            acc[pipeline.id] = pipeline.name;
            return acc;
          },
          {},
        );
      },
      this.MAX_RETRIES,
      this.INITIAL_DELAY,
      'getPipelinesName',
    );
  }

  async getLeadsToday(
    startTimestamp: number,
    endTimestamp: number,
    page: number = 1,
    allLeads: Lead[] = [],
  ): Promise<Lead[]> {
    return this.withRetry(
      async () => {
        const limit = 250;
        const url = `${this.apiUrl}?filter[created_at][from]=${startTimestamp}&filter[created_at][to]=${endTimestamp}&page=${page}&limit=${limit}`;

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
      },
      this.MAX_RETRIES,
      this.INITIAL_DELAY,
      `getLeadsToday: page ${page}`,
    );
  }

  async getLeadById(id: number): Promise<Lead | null> {
    return this.withRetry(
      async () => {
        const url = `${this.apiUrl}/${id}`;

        const response = await this.fetchWithAuth(
          url,
          {},
          {
            maxRetries: 5, // Больше попыток для критичных операций
            initialDelay: 2000,
          },
        );

        if (response.status === 204) {
          return null;
        }

        const data = await response.json();
        return data;
      },
      5, // Увеличиваем количество попыток для получения лида
      2000, // Увеличиваем начальную задержку
      `getLeadById: ${id}`,
    );
  }

  async getContactsByIdLead(idLead: number): Promise<LinkData[]> {
    return this.withRetry(
      async () => {
        const url = `https://${this.domain}.amocrm.ru/api/v4/leads/${idLead}/links`;
        const response = await this.fetchWithAuth(url);
        const data = await response.json();
        return data._embedded.links;
      },
      this.MAX_RETRIES,
      this.INITIAL_DELAY,
      `getContactsByIdLead: ${idLead}`,
    );
  }

  async getNotesByIdContact(idContact: number): Promise<noteType[]> {
    return this.withRetry(
      async () => {
        const url = `https://${this.domain}.amocrm.ru/api/v4/contacts/${idContact}/notes`;
        const response = await this.fetchWithAuth(url);
        const data = await response.json();
        return data._embedded.notes;
      },
      this.MAX_RETRIES,
      this.INITIAL_DELAY,
      `getNotesByIdContact: ${idContact}`,
    );
  }

  async getTasks(idLead: number): Promise<Task[]> {
    return this.withRetry(
      async () => {
        const url = `https://${this.domain}.amocrm.ru/api/v4/tasks?filter[entity_type]=leads&filter[entity_id]=${idLead}`;
        const response = await this.fetchWithAuth(url);
        const data = await response.json();

        return data._embedded.tasks;
      },
      this.MAX_RETRIES,
      this.INITIAL_DELAY,
      `getTasks: ${idLead}`,
    );
  }

  async getResponsibleChanged(
    idLead: number,
  ): Promise<LeadResponsibleChangedEvent[]> {
    return this.withRetry(
      async () => {
        const url = `${this.baseUrl}/events?filter[entity]=lead&filter[entity_id]=${idLead}&filter[type]=entity_responsible_changed`;
        const response = await this.fetchWithAuth(url);

        if (response.status === 204) {
          return [];
        }

        const data = await response.json();
        return data._embedded.events;
      },
      this.MAX_RETRIES,
      this.INITIAL_DELAY,
      `getResponsibleChanged: ${idLead}`,
    );
  }

  async getStatusChanged(idLead: number): Promise<LeadStatusChangedEvent[]> {
    return this.withRetry(
      async () => {
        const url = `${this.baseUrl}/events?filter[entity]=lead&filter[entity_id]=${idLead}&filter[type]=lead_status_changed`;
        const response = await this.fetchWithAuth(url);

        if (response.status === 204) {
          return [];
        }

        const data = await response.json();
        return data._embedded.events;
      },
      this.MAX_RETRIES,
      this.INITIAL_DELAY,
      `getStatusChanged: ${idLead}`,
    );
  }
}
