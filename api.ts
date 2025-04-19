import 'dotenv/config';
import { google } from 'googleapis';
import { Lead, noteType, Pipeline } from './interfaces';

//TODO: заменить на нужное ID таблицы
const SPREADSHEET_ID = '16Gr85TxzbdzXNaZ4UKpxgOa-NeLYQJTIrSB-ol-8CUE';
const SHEET_NAME = 'Time';
const TOKEN = process.env.FETCH_API_TOKEN;
const auth = new google.auth.GoogleAuth({
  keyFile: process.env.PATH_API_GOOGLE,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});
// Домен вашего amoCRM
export const domain = 'agse'; // Замените на ваш домен в amoCRM
// URL API amoCRM
const apiUrl = `https://${domain}.amocrm.ru/api/v4/leads`;
const pipelinesUrl = `https://${domain}.amocrm.ru/api/v4/leads/pipelines`; // URL для получения воронок

const token = process.env.FETCH_API_TOKEN;

export const getNotesByLead = (id: number): Promise<noteType[]> => {
  return fetch(`https://${domain}.amocrm.ru/api/v4/leads/${id}/notes`, {
    headers: {
      Authorization: 'Bearer ' + token,
    },
  })
    .then((res) => {
      if (res.status === 204) {
        return null; // или пустой массив в зависимости от логики
      }
      return res.json();
    })
    .then((res) => {
      return res._embedded.notes;
    });
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

export async function getGoogleSheetData(
  field: string = 'B',
): Promise<Array<string[]>> {
  const sheets = google.sheets({ version: 'v4', auth });
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!${field}2:B150`,
  });
  return response.data.values || [];
}

export async function updateGoogleField(data: string, index: number) {
  const sheets = google.sheets({ version: 'v4', auth });
  const res = await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!L${index}`,
    valueInputOption: 'RAW',
    requestBody: { values: [[data]] },
  });

  return res;
}

type LeadRow = {
  values: (string | number)[][];
};

export async function createGoogleFields(data: LeadRow) {
  const sheets = google.sheets({ version: 'v4', auth });
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: 'A1', // Диапазон, начиная с первой строки
    valueInputOption: 'RAW',
    requestBody: {
      values: data.values,
    },
  });
}

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
