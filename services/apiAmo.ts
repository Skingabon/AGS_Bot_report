import 'dotenv/config';
import { Lead, noteType, Pipeline } from '../interfaces';

const TOKEN = process.env.FETCH_API_TOKEN;
// Домен вашего amoCRM
export const domain = 'agse'; // Замените на ваш домен в amoCRM
// URL API amoCRM
const apiUrl = `https://${domain}.amocrm.ru/api/v4/leads`;
const pipelinesUrl = `https://${domain}.amocrm.ru/api/v4/leads/pipelines`; // URL для получения воронок

const token = process.env.FETCH_API_TOKEN;

//Получаю сделки по ID Анализ
// export const getLeadById = async (id: number): Promise<Lead> => {
//   const response = await fetch(`${apiUrl}/${id}`, {
//     headers: {
//       Authorization: 'Bearer ' + token,
//     },
//   });
//
//   if (!response.ok) {
//     throw new Error(
//       `Ошибка получения сделки с ID ${id}: ${response.statusText}`,
//     );
//   }
//
//   const lead = await response.json();
//   return lead;
// };
//
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
  const response: any = await fetch(pipelinesUrl, {
    headers: {
      Authorization: `Bearer ${TOKEN}`,
    },
  });
  const res = await response.json();
  return res._embedded.pipelines;
}

export async function getLeadToday(
  startTimestamp: number,
  endTimestamp: number,
): Promise<Lead[]> {
  const response: any = await fetch(
    `${apiUrl}?filter[created_at][from]=${startTimestamp}&filter[created_at][to]=${endTimestamp}`,
    {
      headers: {
        Authorization: `Bearer ${TOKEN}`,
      },
    },
  );
  const res = await response.json();
  return res._embedded.leads;
}

export async function getLeadById(id: number): Promise<Lead> {
  const response: any = await fetch(`${apiUrl}/${id}`, {
    headers: {
      Authorization: `Bearer ${TOKEN}`,
    },
  });
  const res = await response.json();
  return res;
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
