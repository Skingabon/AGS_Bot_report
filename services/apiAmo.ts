import 'dotenv/config';
import { Lead, noteType, Pipeline } from '../interfaces';

const TOKEN = process.env.FETCH_API_TOKEN;
// Домен вашего amoCRM
export const domain = 'agse'; // Замените на ваш домен в amoCRM
// URL API amoCRM
const apiUrl = `https://${domain}.amocrm.ru/api/v4/leads`;
const pipelinesUrl = `https://${domain}.amocrm.ru/api/v4/leads/pipelines`; // URL для получения воронок

const token = process.env.FETCH_API_TOKEN;

export const getNotesByLead = async (
  id: number,
): Promise<noteType[] | null> => {
  const res = await fetch(
    `https://${domain}.amocrm.ru/api/v4/leads/${id}/notes`,
    {
      headers: {
        Authorization: 'Bearer ' + token,
      },
    },
  );

  if (res.status === 204) return null;
  const data: { _embedded: { notes: noteType[] } } = await res.json();

  if (!data._embedded) return null;
  return data._embedded.notes;
};

export const updateLeadDateCall = (id: number, date: string) => {
  return fetch(`https://${domain}.amocrm.ru/api/v4/leads/${id}`, {
    method: 'PATCH',
    headers: {
      Authorization: 'Bearer ' + token,
    },
    body: JSON.stringify({
      custom_fields_values: [
        {
          field_id: 607249, // ID поля "Первый исходящий"
          values: [{ value: date }], // Формат: ГГГГ-ММ-ДД ЧЧ:ММ:СС
        },
      ],
    }),
  }).then((res) => res.json());
};

export async function getAllPipelines(): Promise<Pipeline[]> {
  const response = await fetch(pipelinesUrl, {
    headers: {
      Authorization: `Bearer ${TOKEN}`,
    },
  });
  const res = await response.json();
  return res._embedded.pipelines;
}

export async function getLeadsToday(
  startTimestamp: number,
  endTimestamp: number,
  page: number = 1,
  allLeads: Lead[] = [],
): Promise<Lead[]> {
  try {
    const limit = 250; // Максимальное количество сделок на страницу
    const response = await fetch(
      `${apiUrl}?filter[created_at][from]=${startTimestamp}&filter[created_at][to]=${endTimestamp}&page=${page}&limit=${limit}`,
      {
        headers: {
          Authorization: `Bearer ${TOKEN}`,
        },
      },
    );

    if (!response.ok) {
      throw new Error(`Ошибка API: ${response.status} ${response.statusText}`);
    }

    const res = await response.json();
    const leads = res._embedded?.leads || [];

    // Собираем все сделки рекурсивно
    const collectedLeads = [...allLeads, ...leads];

    // Если есть больше страниц, делаем следующий запрос
    if (leads.length === limit) {
      return getLeadsToday(
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

export async function getAllDealsForPeriod(
  startTimestamp: number,
  endTimestamp: number,
) {
  const limit = 250; // Максимальное количество на страницу
  let page = 1;
  let allDeals: Lead[] = [];
  let hasMore = true;

  while (hasMore) {
    try {
      const response = await fetch(
        `${apiUrl}?page=${page}&limit=${limit}&filter[created_at][from]=${startTimestamp}&filter[created_at][to]=${endTimestamp}`,
        {
          headers: {
            Authorization: `Bearer ${TOKEN}`,
            'Content-Type': 'application/json',
          },
        },
      );

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      const deals = data._embedded?.leads || [];

      if (deals.length > 0) {
        allDeals = allDeals.concat(deals);
        page++;

        // Проверяем, есть ли еще данные
        if (deals.length < limit) {
          hasMore = false;
        }
      } else {
        hasMore = false;
      }

      // Добавляем задержку чтобы не превысить лимиты API
      await new Promise((resolve) => setTimeout(resolve, 100));
    } catch (error) {
      console.error('Error fetching deals:', error);
      hasMore = false;
    }
  }

  return allDeals;
}

export async function getLeadById(id: number): Promise<Lead | null> {
  try {
    const response = await fetch(`${apiUrl}/${id}`, {
      headers: {
        Authorization: `Bearer ${TOKEN}`,
      },
    });
    if (response.status === 204) {
      // Сделка не найдена или удалена
      return null;
    }

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error(`Error fetching lead ${id}:`, error);
    return null;
  }
}

interface IGetContactsBtIdLeadProps {
  to_entity_id: number;
  to_entity_type: string;
  metadata: {
    main_contact: boolean;
  } | null;
}

export const getContactsByIdLead = async (
  idLead: number,
): Promise<IGetContactsBtIdLeadProps[]> => {
  const res = await fetch(
    `https://${domain}.amocrm.ru/api/v4/leads/${idLead}/links`,
    {
      headers: {
        Authorization: `Bearer ${TOKEN}`,
      },
    },
  );
  const data = await res.json();
  return data._embedded.links;
};

export const getNotesByIdContact = async (
  idContact: number,
): Promise<noteType[]> => {
  const res = await fetch(
    `https://${domain}.amocrm.ru/api/v4/contacts/${idContact}/notes`,
    {
      headers: {
        Authorization: `Bearer ${TOKEN}`,
      },
    },
  );
  const data = await res.json();
  return data._embedded.notes;
};
