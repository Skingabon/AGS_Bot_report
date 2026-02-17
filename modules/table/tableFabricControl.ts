import { AmoAPI } from '../../services/apiAmo';
import {
  Task,
  LeadStatusChangedEvent,
  LeadResponsibleChangedEvent,
} from '../../interfaces';

import { getDate, formatTimeHHMMSS } from '../../util/helper';
import { getStatusLead } from '../statusList';
import { communicationType } from '../updateFields';

export interface CreateBaseRowParams {
  leadId: number;
  name: string;
  url: string;
  createdAtFormatted: string;
  day: string;
  month: string;
  year: string;
  status: string;
  pipeline: string;
  createAt: number;
}

export interface BaseRowData {
  leadId: number;
  name: string;
  url: string;
  createdAt: string;
  responsible: string;
  day: string | number;
  month: string | number;
  year: string | number;
  status: string;
  pipeline: string;
  createAt: number;
}

export interface ActionRowParams {
  baseRow: BaseRowData;
  amo: AmoAPI;
  pipelinesMap: { [key: number]: string };
  isFirstAction?: boolean;
}

export interface CommunicationParams extends ActionRowParams {
  type: 'communication';
  touch: communicationType;
}

export interface TaskParams extends ActionRowParams {
  type: 'task';
  task: Task;
}

export interface StatusChangeParams extends ActionRowParams {
  type: 'status_change';
  statusChange: LeadStatusChangedEvent;
}

export interface ResponsibleChangeParams extends ActionRowParams {
  type: 'responsible_change';
  respChange: LeadResponsibleChangedEvent;
}

export type CreateRowParams =
  | CommunicationParams
  | TaskParams
  | StatusChangeParams
  | ResponsibleChangeParams;

export class ReportRowFactory {
  static readonly BASE_ROW_LENGTH: number = 31; // AE = 31 колонка (0-30)
  // Функция для гарантированного форматирования с ведущими нулями
  static removeLeadingZero(value: string | number): string {
    const str = String(value);
    if (str.startsWith('0')) {
      return str.slice(1);
    }

    return str;
  }

  // Метод для создания базовой строки (совместим с createReportControlByPeriod)
  static createBaseRow(params: CreateBaseRowParams): (string | number)[] {
    const row = new Array(this.BASE_ROW_LENGTH).fill('');
    const {
      leadId,
      name,
      url,
      createdAtFormatted,
      day,
      month,
      year,
      status,
      pipeline,
      createAt,
    } = params;

    row[0] = leadId; // A
    row[1] = name; // B
    row[2] = url; // C
    row[3] = createdAtFormatted; // D
    row[4] = ''; // E - Ответственный (пусто)

    // F, G, H - пустые (будут заполнены при update)

    row[14] = this.removeLeadingZero(day); // O
    row[15] = this.removeLeadingZero(month); // P
    row[16] = this.removeLeadingZero(year); // Q

    // R - пусто

    row[18] = status; // S
    row[19] = pipeline; // T

    // U-AE - пустые

    row[31] = createAt;

    return row;
  }

  // Создание базового шаблона строки
  static createBaseTemplate(baseRow: BaseRowData): (string | number)[] {
    const row = new Array(this.BASE_ROW_LENGTH).fill('');

    // Заполняем базовые данные
    row[0] = baseRow.leadId; // A: ID сделки
    row[1] = baseRow.name || ''; // B: Название
    row[2] = baseRow.url || ''; // C: Ссылка
    row[3] = baseRow.createdAt || ''; // D: Дата создания
    row[4] = baseRow.responsible || ''; // E: Ответственный

    // День, месяц, год (O, P, Q) - ГАРАНТИРУЕМ ведущие нули
    row[14] = this.removeLeadingZero(baseRow.day); // O: День
    row[15] = this.removeLeadingZero(baseRow.month); // P: Месяц
    row[16] = this.removeLeadingZero(baseRow.year); // Q: Год

    row[18] = baseRow.status || ''; // S: Статус
    row[19] = baseRow.pipeline || ''; // T: Воронка

    row[31] = baseRow.createAt; //

    return row;
  }

  // Создание строки для коммуникаций
  static async createCommunicationRow(
    params: CommunicationParams,
  ): Promise<(string | number)[]> {
    const { touch, baseRow, amo, isFirstAction = false } = params;

    // Пропускаем звонки без ссылки (кроме первого действия)
    if (touch.source === 'Звонок' && !touch.linkCall && !isFirstAction) {
      throw new Error('Звонок без ссылки пропускается');
    }

    const [y, mon, d, h, m, s] = getDate(touch.time);
    const responsible = await amo.getUser(touch.responsibleUserId);

    const row = this.createBaseTemplate(baseRow);

    row[5] = touch.core || ''; // F: Тип
    row[6] = touch.source || ''; // G: Источник
    row[7] = touch.text || ''; // H: Текст
    // I: Тип коммуникации
    row[8] = `${touch.source} ${
      touch.source === 'Письмо' || touch.source === 'Звонок'
        ? touch.income
          ? 'вход'
          : 'исх'
        : ''
    }`;
    row[9] =
      touch.source === 'Звонок' // J: Звонок выполнен?
        ? touch.isDoCall
          ? 'Да'
          : 'Нет'
        : '';
    row[10] =
      touch.source === 'Звонок' && touch.isDoCall // K: Длительность звонка
        ? formatTimeHHMMSS(touch.durationCall || 0)
        : '';
    row[11] = `${y}.${mon}.${d}`; // L: Дата действия
    row[12] = `${h}:${m}:${s}`; // M: Время действия
    row[17] = touch.linkCall || ''; // R: Ссылка на звонок
    row[28] = responsible ? responsible.name : ''; // AC: Ответственный за действие

    return row;
  }

  // Создание строки для задач
  static async createTaskRow(params: TaskParams): Promise<(string | number)[]> {
    const { task, baseRow, amo } = params;

    const [y, mon, d, h, m, s] = getDate(task.created_at);
    const responsible = await amo.getUser(task.responsible_user_id);

    const row = this.createBaseTemplate(baseRow);

    row[5] = 'task'; // F: Тип
    row[6] = 'Задачи'; // G: Источник
    row[7] = task.text || ''; // H: Текст
    row[8] = 'Задача'; // I: Тип
    row[9] = task.is_completed ? 'Да' : 'Нет'; // J: Выполнено?
    row[11] = `${y}.${mon}.${d}`; // L: Дата
    row[12] = `${h}:${m}:${s}`; // M: Время
    row[13] = formatTimeHHMMSS(task.duration); // N: Длительность
    row[28] = responsible ? responsible.name : ''; // AC: Ответственный

    return row;
  }

  // Создание строки для смены статуса/воронки
  static async createStatusChangeRow(
    params: StatusChangeParams,
  ): Promise<(string | number)[]> {
    const { statusChange, baseRow, amo, pipelinesMap } = params;

    const [y, mon, d, h, m, s] = getDate(statusChange.created_at);

    const leadBefore = statusChange.value_before[0].lead_status;
    const leadAfter = statusChange.value_after[0].lead_status;
    const responsible = await amo.getUser(statusChange.created_by);

    const statusBefore = getStatusLead({
      statusId: leadBefore.id,
      pipelineId: leadBefore.pipeline_id,
    });
    const pipelineNameBefore =
      pipelinesMap[leadBefore.pipeline_id] || 'Не найдено';

    const statusAfter = getStatusLead({
      statusId: leadAfter.id,
      pipelineId: leadAfter.pipeline_id,
    });
    const pipelineNameAfter =
      pipelinesMap[leadAfter.pipeline_id] || 'Не найдено';

    const row = this.createBaseTemplate(baseRow);

    row[5] = 'event'; // F: Тип
    row[6] = 'Этап/Воронка'; // G: Источник
    row[20] = `${y}.${mon}.${d}`; // U: Дата изменения
    row[21] = `${h}:${m}:${s}`; // V: Время изменения
    row[22] = pipelineNameBefore; // W: Воронка до
    row[23] = statusBefore; // X: Статус до
    row[24] = pipelineNameAfter; // Y: Воронка после
    row[25] = statusAfter; // Z: Статус после
    row[28] = responsible ? responsible.name : ''; // AC: Кто изменил

    return row;
  }

  // Создание строки для смены ответственного
  static async createResponsibleChangeRow(
    params: ResponsibleChangeParams,
  ): Promise<(string | number)[]> {
    const { respChange, baseRow, amo } = params;

    const [y, mon, d, h, m, s] = getDate(respChange.created_at);

    let responsibleChanged = 'Робот';
    if (respChange.created_by) {
      const user = await amo.getUser(respChange.created_by);
      responsibleChanged = user ? user.name : '';
    }

    const leadBefore = respChange.value_before[0].responsible_user;
    const leadAfter = respChange.value_after[0].responsible_user;
    const responsibleBefore = await amo.getUser(leadBefore.id);
    const responsibleAfter = await amo.getUser(leadAfter.id);

    const row = this.createBaseTemplate(baseRow);

    row[5] = 'event'; // F: Тип
    row[6] = 'Смена ответственного'; // G: Источник
    row[26] = responsibleBefore ? responsibleBefore.name : ''; // AA: Ответственный до
    row[27] = responsibleAfter ? responsibleAfter.name : ''; // AB: Ответственный после
    row[28] = responsibleChanged; // AC: Кто изменил
    row[29] = `${y}.${mon}.${d}`; // AD: Дата изменения
    row[30] = `${h}:${m}:${s}`; // AE: Время изменения

    return row;
  }

  // Универсальный метод для создания строки
  static async createRow(
    params: CreateRowParams,
  ): Promise<(string | number)[]> {
    switch (params.type) {
      case 'communication':
        return this.createCommunicationRow(params);
      case 'task':
        return this.createTaskRow(params);
      case 'status_change':
        return this.createStatusChangeRow(params);
      case 'responsible_change':
        return this.createResponsibleChangeRow(params);
      default:
        throw new Error(`Неизвестный тип действия: ${(params as any).type}`);
    }
  }

  // Создание BaseRowData из массива строк таблицы
  static createBaseRowDataFromArray(
    row: (string | number)[],
    leadId: number,
  ): BaseRowData {
    return {
      leadId,
      name: String(row[1] || ''),
      url: String(row[2] || ''),
      createdAt: String(row[3] || ''),
      responsible: String(row[4] || ''),
      day: row[14],
      month: row[15],
      year: row[16],
      status: String(row[18] || ''),
      pipeline: String(row[19] || ''),
      createAt: Number(row[31] || 0),
    };
  }

  // Вспомогательный метод для проверки, пустая ли базовая строка
  static isBaseRowEmpty(row: (string | number)[]): boolean {
    return !row[5] && !row[6] && !row[7]; // F, G, H пустые
  }
}
