import 'dotenv/config';
import { google, GoogleApis } from 'googleapis';
import { parseDateTime } from '../util/helper';
import { GoogleAuth } from 'google-auth-library';

// Базовый класс для работы с Google Sheets
export class GoogleSheetService {
  protected readonly SPREADSHEET_ID: string;
  protected readonly auth: GoogleAuth;
  protected readonly google: GoogleApis;
  protected sheetName: string;
  protected countQuartetRow: number;
  protected columnIndexForSorting: number;

  constructor(
    sheetName: string,
    countQuartetRow: number,
    columnIndexForSorting: number,
  ) {
    this.SPREADSHEET_ID = process.env.SPREADSHEET_ID!;
    this.sheetName = sheetName;
    this.countQuartetRow = countQuartetRow;
    this.auth = new google.auth.GoogleAuth({
      keyFile: process.env.PATH_API_GOOGLE,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    this.google = google;
    this.columnIndexForSorting = columnIndexForSorting;
  }

  // Получение стартовой строки за квартал
  startRangeWith = (flag: boolean, allRow: number) => {
    const firstRow = 2;
    let needRow = this.countQuartetRow;
    let startRangeWith = allRow - needRow;

    // Если строк меньше 1700 (квартал), то начинай со второй строки
    if (needRow > allRow) {
      startRangeWith = firstRow;
    }

    return flag ? firstRow : startRangeWith;
  };

  // Ищу номер последней строки
  async getLastRowGoogleSheet(): Promise<number> {
    const sheets = this.google.sheets({ version: 'v4', auth: this.auth });

    const columnResponse = await sheets.spreadsheets.values.get({
      spreadsheetId: this.SPREADSHEET_ID,
      range: `${this.sheetName}!A2:A`,
    });

    const values = columnResponse.data.values || [];
    return values.length + 1;
  }

  // Получаю все строки в столбце
  async getGoogleSheetData(field: string = 'A'): Promise<Array<string[]>> {
    const sheets = this.google.sheets({ version: 'v4', auth: this.auth });
    const lastRow = await this.getLastRowGoogleSheet();

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: this.SPREADSHEET_ID,
      range: `${this.sheetName}!${field}2:${field}${lastRow}`,
    });

    return response.data.values || [];
  }

  // Получаю все поля из таблицы
  async getRangeValues(range: string): Promise<Array<string[]>> {
    const sheets = this.google.sheets({ version: 'v4', auth: this.auth });

    try {
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId: this.SPREADSHEET_ID,
        range: `${this.sheetName}!${range}`,
        valueRenderOption: 'FORMATTED_VALUE',
      });

      return response.data.values || [];
    } catch (error) {
      console.error(`Ошибка получения диапазона ${range}:`, error);
      return [];
    }
  }

  async updateGoogleField(
    data: string,
    index: number,
    fieldName: string = 'T',
  ) {
    const sheets = this.google.sheets({ version: 'v4', auth: this.auth });
    const res = await sheets.spreadsheets.values.update({
      spreadsheetId: this.SPREADSHEET_ID,
      range: `${this.sheetName}!${fieldName}${index}`,
      valueInputOption: 'RAW',
      requestBody: { values: [[data]] },
    });

    return res;
  }

  async createGoogleFields(data: { values: (string | number)[][] }) {
    const sheets = this.google.sheets({ version: 'v4', auth: this.auth });
    await sheets.spreadsheets.values.append({
      spreadsheetId: this.SPREADSHEET_ID,
      range: `${this.sheetName}!A1`,
      valueInputOption: 'RAW',
      requestBody: {
        values: data.values,
      },
    });
  }

  async updateFieldsGooglePack(
    sheetUpdates: { range: string; values: (string | number)[][] }[],
  ) {
    const sheets = this.google.sheets({ version: 'v4', auth: this.auth });

    const updatesWithSheet = sheetUpdates.map((update) => ({
      ...update,
      range: `${this.sheetName}!${update.range}`,
    }));

    const filteredUpdates = updatesWithSheet.filter((u) => u.values.length > 0);
    if (filteredUpdates.length > 0) {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: this.SPREADSHEET_ID,
        requestBody: {
          data: filteredUpdates,
          valueInputOption: 'RAW',
        },
      });
    }
  }
  async sortSheetByDate(isAllField: boolean = false): Promise<void> {
    const sheets = this.google.sheets({ version: 'v4', auth: this.auth });
    const lastRow = 'AL';

    try {
      const rowLength = (await this.getGoogleSheetData('A')).flat().length + 1;
      const startRange = this.startRangeWith(isAllField, rowLength);

      const response = await sheets.spreadsheets.values.get({
        spreadsheetId: this.SPREADSHEET_ID,
        range: `${this.sheetName}!A${startRange}:${lastRow}`,
      });

      const data: any[][] = response.data.values || [];
      if (data.length === 0) {
        console.log('Нет данных для сортировки');
        return;
      }

      const dataWithDebug = data.map((row, index) => {
        const dateString = row[this.columnIndexForSorting];
        const parsedDate = parseDateTime(dateString);

        return {
          originalIndex: index,
          row: row,
          dateString: dateString,
          parsedDate: parsedDate,
          timestamp: parsedDate ? parsedDate.getTime() : 0,
        };
      });

      const sortedWithDebug = dataWithDebug.sort((a, b) => {
        if (!a.parsedDate && !b.parsedDate) return 0;
        if (!a.parsedDate) return 1;
        if (!b.parsedDate) return -1;

        return a.timestamp - b.timestamp;
      });

      const sortedData = sortedWithDebug.map((item) => item.row);

      await sheets.spreadsheets.values.update({
        spreadsheetId: this.SPREADSHEET_ID,
        range: `${this.sheetName}!A${startRange}:${lastRow}`,
        valueInputOption: 'RAW',
        requestBody: {
          values: sortedData,
        },
      });
    } catch (error) {
      console.error('Ошибка сортировки:', error);
      throw error;
    }
  }
  // Пакетное создание строк (под капотом использует batchUpdate)
}

// Специализированный класс для листа Time с дополнительной логикой
export class TimeSheetService extends GoogleSheetService {
  constructor() {
    super('Time', 1700, 6); // Всегда работаем с листом Time
  }
}

// Специализированный класс для листа Control
export class ControlSheetService extends GoogleSheetService {
  constructor() {
    // TODO: countQuartetRow еще не работает для Control
    super('Control', 1500, 3);
  }

  // Получаем последнюю заполненную строку (исправленная версия)
  async getLastRow(): Promise<number> {
    try {
      const response = await this.getRangeValues('A:A');
      return response.length + 1; // +1 потому что A2 это первая строка данных
    } catch (error) {
      console.error('Ошибка получения последней строки:', error);
      return 1;
    }
  }

  // Пакетное создание строк
  async createGoogleFieldsBatch(data: { values: any[][] }): Promise<void> {
    try {
      if (data.values.length === 0) return;

      console.log(`📦 Пакетное создание ${data.values.length} строк`);

      // Получаем последнюю строку
      const lastRow = await this.getLastRow();
      const startRow = lastRow + 1;
      const endRow = startRow + data.values.length - 1;

      await this.updateFieldsGooglePack([
        {
          range: `A${startRow}:R${endRow}`,
          values: data.values,
        },
      ]);

      console.log(`✅ Создано строк ${startRow}-${endRow}`);
    } catch (error: any) {
      // Тот же принцип: если grid limits - расширяем
      if (
        error.message.includes('exceeds grid limits') ||
        error.message.includes('Max rows')
      ) {
        console.log(
          '⚠️ Ошибка создания: превышены границы таблицы. Расширяем...',
        );

        try {
          await this.expandSheet(500);
          await new Promise((resolve) => setTimeout(resolve, 1000));

          console.log('🔄 Повторная попытка создания...');
          await this.createGoogleFieldsBatch(data);
        } catch (expandError) {
          console.error('❌ Не удалось расширить таблицу:', expandError);

          // Пробуем добавить через append
          console.log('🔄 Пробуем добавить через append...');
          await this.appendRowsSafely(data.values);
        }
      } else {
        console.error('❌ Ошибка пакетного создания строк:', error);
        throw error;
      }
    }
  }

  // Метод append для безопасного добавления строк
  async appendRowsSafely(values: any[][]): Promise<void> {
    try {
      const sheets = this.google.sheets({ version: 'v4', auth: this.auth });

      await sheets.spreadsheets.values.append({
        spreadsheetId: this.SPREADSHEET_ID,
        range: `${this.sheetName}!A:R`,
        valueInputOption: 'USER_ENTERED',
        insertDataOption: 'INSERT_ROWS',
        requestBody: {
          values: values,
        },
      });

      console.log(`✅ Добавлено ${values.length} строк через append`);
    } catch (error) {
      console.error('❌ Ошибка добавления строк:', error);
      throw error;
    }
  }

  // Пакетное обновление ячеек
  async batchUpdateCells(
    data: Array<{ range: string; values: any[][] }>,
  ): Promise<void> {
    try {
      if (data.length === 0) return;

      console.log(`📦 Пакетное обновление ${data.length} диапазонов`);

      const resource = {
        valueInputOption: 'USER_ENTERED',
        data: data.map((item) => ({
          range: `${this.sheetName}!${item.range}`,
          values: item.values,
        })),
      };

      const sheets = this.google.sheets({ version: 'v4', auth: this.auth });

      const response = await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: this.SPREADSHEET_ID,
        requestBody: resource,
      });

      console.log(`✅ Обновлено ${response.data.totalUpdatedCells} ячеек`);
    } catch (error: any) {
      // ПРОВЕРЯЕМ, если ошибка из-за grid limits - расширяем таблицу и пробуем снова
      if (
        error.message.includes('exceeds grid limits') ||
        error.message.includes('Max rows') ||
        error.message.includes('grid limits')
      ) {
        console.log('⚠️ Ошибка: превышены границы таблицы. Расширяем...');

        try {
          // Расширяем таблицу на 500 строк
          await this.expandSheet(500);

          // Ждем немного
          await new Promise((resolve) => setTimeout(resolve, 1000));

          // Пробуем снова
          console.log('🔄 Повторная попытка обновления...');
          await this.batchUpdateCells(data);
        } catch (expandError) {
          console.error('❌ Не удалось расширить таблицу:', expandError);

          // Если не удалось расширить, пробуем обновить по одной строке
          console.log('🔄 Пробуем обновить по одной строке...');
          for (const item of data) {
            try {
              await this.updateSingleRange(item.range, item.values[0]);
              await new Promise((resolve) => setTimeout(resolve, 100));
            } catch (singleError) {
              console.error(`❌ Ошибка обновления ${item.range}:`, singleError);
            }
          }
        }
      } else {
        // Другие ошибки просто пробрасываем
        console.error('❌ Ошибка пакетного обновления:', error.message);
        throw error;
      }
    }
  }

  // Вспомогательный метод для обновления одного диапазона
  private async updateSingleRange(range: string, values: any[]): Promise<void> {
    const sheets = this.google.sheets({ version: 'v4', auth: this.auth });

    await sheets.spreadsheets.values.update({
      spreadsheetId: this.SPREADSHEET_ID,
      range: `${this.sheetName}!${range}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [values] },
    });
  }

  // Утилита для обработки больших пакетов с задержками
  async processInBatches<T>(
    items: T[],
    processor: (batch: T[], batchIndex: number) => Promise<void>,
    batchSize: number = 20,
    delayBetweenBatches: number = 1000,
  ): Promise<void> {
    const totalBatches = Math.ceil(items.length / batchSize);

    for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
      const start = batchIndex * batchSize;
      const end = Math.min(start + batchSize, items.length);
      const batch = items.slice(start, end);

      console.log(
        `🔄 Обработка пакета ${batchIndex + 1}/${totalBatches} (${batch.length} элементов)`,
      );

      try {
        await processor(batch, batchIndex);
      } catch (error) {
        console.error(`❌ Ошибка в пакете ${batchIndex + 1}:`, error);
        // Продолжаем обработку остальных пакетов
      }

      // Задержка между пакетами
      if (batchIndex < totalBatches - 1) {
        await new Promise((resolve) =>
          setTimeout(resolve, delayBetweenBatches),
        );
      }
    }
  }

  // Получение строк с фильтрацией по leadId
  async expandSheet(additionalRows: number = 500): Promise<void> {
    try {
      const sheets = this.google.sheets({ version: 'v4', auth: this.auth });

      // Получаем ID листа
      const spreadsheet = await sheets.spreadsheets.get({
        spreadsheetId: this.SPREADSHEET_ID,
      });

      const sheet = spreadsheet.data.sheets?.find(
        (s) => s.properties?.title === this.sheetName,
      );

      const sheetId = sheet?.properties?.sheetId;
      if (!sheetId) {
        throw new Error('Не удалось найти ID листа');
      }

      // Получаем текущие размеры
      const currentRowCount =
        sheet?.properties?.gridProperties?.rowCount || 1000;
      const currentColCount =
        sheet?.properties?.gridProperties?.columnCount || 26;

      const newRowCount = currentRowCount + additionalRows;

      console.log(
        `📏 Расширение таблицы: ${currentRowCount} → ${newRowCount} строк`,
      );

      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: this.SPREADSHEET_ID,
        requestBody: {
          requests: [
            {
              updateSheetProperties: {
                properties: {
                  sheetId: sheetId,
                  gridProperties: {
                    rowCount: newRowCount,
                    columnCount: Math.max(currentColCount, 29), // A:AC
                  },
                },
                fields: 'gridProperties.rowCount,gridProperties.columnCount',
              },
            },
          ],
        },
      });

      console.log(`✅ Таблица расширена до ${newRowCount} строк`);
    } catch (error) {
      console.error('❌ Ошибка расширения таблицы:', error);
      throw error;
    }
  }
}
