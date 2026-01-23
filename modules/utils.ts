import { AmoAPI } from '../services/apiAmo';
import {
  formatDate,
  formatDateByPeriod,
  formatSecondsToHHMM,
  getDate,
  getFieldValue,
  parseDate,
  returnTypeParseDate,
} from '../util/helper';
import { IUser, Lead, LeadStatusChangedEvent } from '../interfaces';
import { getStatusLead } from './statusList';

export const getLeaderAtInProgressStatus = async (
  amo: AmoAPI,
  leadId: number,
  inProgressTimestamp: number,
): Promise<IUser | null> => {
  try {
    // Получаем все смены ответственного
    const changes = await amo.getResponsibleChanged(leadId);

    if (!changes || changes.length === 0) {
      // Если смен не было, возвращаем null
      return null;
    }

    // Сортируем смены по времени (от старых к новым)
    const sortedChanges = [...changes].sort(
      (a, b) => a.created_at - b.created_at,
    );

    // Ищем ПОСЛЕДНЮЮ смену, которая произошла ДО момента "Взято в работу"
    let lastChangeBeforeInProgress = null;

    for (const change of sortedChanges) {
      if (change.created_at <= inProgressTimestamp) {
        lastChangeBeforeInProgress = change;
      } else {
        break; // Дошли до смены после "Взято в работу"
      }
    }

    // Если нашли смену ДО "Взято в работу" - берем ответственного ПОСЛЕ этой смены
    if (lastChangeBeforeInProgress) {
      const responsibleId =
        lastChangeBeforeInProgress.value_after[0].responsible_user.id;
      return await amo.getUser(responsibleId);
    }

    // Если все смены произошли ПОСЛЕ "Взято в работу" - берем ответственного ДО первой смены
    const firstChange = sortedChanges[0];
    const initialResponsibleId =
      firstChange.value_before[0].responsible_user.id;
    return await amo.getUser(initialResponsibleId);
  } catch (error) {
    console.error(`Ошибка поиска руководителя для сделки ${leadId}:`, error);
    return null;
  }
};

export const getLeadsTodayOrByPeriod = async (
  startDate?: string,
  endDate?: string,
): Promise<{ leads: Lead[]; pipelinesMap: { [p: number]: string } }> => {
  const pipelinesResponse = await new AmoAPI().getAllPipelines();
  const pipelines = pipelinesResponse;
  const pipelinesMap = pipelines.reduce(
    (
      acc: { [key: number]: string },
      pipeline: { id: number; name: string },
    ) => {
      acc[pipeline.id] = pipeline.name;
      return acc;
    },
    {},
  );
  let startTimestamp;
  let endTimestamp;
  // Пример временных меток (начало и конец дня)
  if (!startDate || !endDate) {
    const today = new Date();

    const startOfDay = new Date(today);
    const endOfDay = new Date(today);

    startOfDay.setHours(0, 0, 0, 0);
    endOfDay.setHours(23, 59, 59, 999);

    // Конвертируем в Unix timestamp (секунды)
    startTimestamp = Math.floor(startOfDay.getTime() / 1000); //TODO Для прода
    endTimestamp = Math.floor(endOfDay.getTime() / 1000);
  } else {
    const startDateFormated = new Date(formatDateByPeriod(startDate));
    const endDateFormated = new Date(formatDateByPeriod(endDate));
    endDateFormated.setHours(23, 59, 59, 999);

    startTimestamp = Math.floor(startDateFormated.getTime() / 1000);
    endTimestamp = Math.floor(endDateFormated.getTime() / 1000);
  }

  const response = await new AmoAPI().getLeadsToday(
    startTimestamp,
    endTimestamp,
  );

  let leads = response;
  if (!leads || leads.length === 0) {
    throw new Error('No leads found for the given filter.');
  }
  leads.sort((a, b) => a.created_at - b.created_at);

  return {
    leads,
    pipelinesMap,
  };
};

type getParamsLeadType = {
  lead: Lead;
  pipelinesMap: { [p: number]: string };
  amo: AmoAPI;
};

type commonFields = {
  delta: string;
  createAt: string;
  responsible?: string;
};

type returnTypeParamsLead = {
  newLeadSource: string;
  statusName: string;
  pipelineName: string;
  leadStatusNewRequest: number;
  leadStatusInProgress: LeadStatusChangedEvent | undefined;
  deltaMain: string;
  leader: string;
  serial: commonFields;
  engine: commonFields;
  formattedUpdatedAt: string;
  reasonForRefusal: string;
  totalTimeLead: string;
  nameIndustry: string;
  nameProduct: string;
  dateFormatted: returnTypeParseDate;
  currentResponsible: IUser | null;
  leadLastClosed: LeadStatusChangedEvent | undefined;
};

type getDataStatusLeadReturn = {
  findLeadInProgress: LeadStatusChangedEvent | undefined;
  leadStatusSerial: LeadStatusChangedEvent | undefined;
  leadStatusEngine: LeadStatusChangedEvent | undefined;
  leadLastClosed: LeadStatusChangedEvent | undefined;
};

export const getDataStatusLead = async (
  amo: AmoAPI,
  lead: Lead,
): Promise<getDataStatusLeadReturn> => {
  const statusChanged = await amo.getStatusChanged(lead.id);

  // Взято в работу
  const findLeadInProgress = statusChanged.find(
    (el) => el.value_after[0].lead_status.id === 50238952,
  );

  // Распред на квал серия
  const leadStatusSerial = statusChanged.find(
    (el) => el.value_after[0].lead_status.id === 56123746,
  );
  // Распред на квал инж
  const leadStatusEngine = statusChanged.find(
    (el) => el.value_after[0].lead_status.id === 73470054,
  );

  // Последний закрытый
  const leadLastClosed = statusChanged.find(
    (el) => el.value_after[0].lead_status.id === 143,
  );

  return {
    findLeadInProgress,
    leadStatusSerial,
    leadStatusEngine,
    leadLastClosed,
  };
};

export const getParamsLead = async ({
  lead,
  pipelinesMap,
  amo,
}: getParamsLeadType): Promise<returnTypeParamsLead> => {
  const pipelineName = pipelinesMap[lead.pipeline_id] || 'Не найдено';

  // Добавляем название статуса в зависимости от ID статуса
  const statusName = getStatusLead({
    statusId: lead.status_id,
    pipelineId: lead.pipeline_id,
  });

  const currentResponsible = await amo.getUser(lead.responsible_user_id);

  let leader: IUser | null = null;

  // Новая заявка
  const leadStatusNewRequest = lead.created_at;

  const {
    findLeadInProgress,
    leadStatusSerial,
    leadStatusEngine,
    leadLastClosed,
  } = await getDataStatusLead(amo, lead);

  const getLeadStatusData = (leadCurrentStatus?: LeadStatusChangedEvent) => {
    if (!leadCurrentStatus || !findLeadInProgress) {
      return {
        delta: '',
        createAt: '',
        responsible: '',
      };
    }
    // Время взято в работу
    const [y, month, d, h, min] = getDate(leadCurrentStatus.created_at || 0);

    // Дельта от взято в работу до раcпределения
    const deltaSerial =
      leadCurrentStatus.created_at - findLeadInProgress.created_at;
    const delta = formatSecondsToHHMM(deltaSerial);

    return {
      delta,
      createAt: `${y}.${month}.${d} ${h}:${min}`,
      responsible: currentResponsible?.name,
    };
  };

  // Рук отдела
  if (findLeadInProgress) {
    leader = await getLeaderAtInProgressStatus(
      amo,
      lead.id,
      findLeadInProgress.created_at,
    );
  }

  // Дельта от создания до взято в работу
  const deltaMain = findLeadInProgress
    ? formatSecondsToHHMM(findLeadInProgress.created_at - lead.created_at)
    : '';

  //новые поля
  const fields = lead.custom_fields_values || [];
  const newLeadSource = getFieldValue(fields, 'Источник лида') || '';
  const reasonForRefusal = getFieldValue(fields, 'Причина отказа') || '';
  const dateContract = getFieldValue(fields, 'Дата Договор заключен');
  const dateNoLead = getFieldValue(fields, 'Дата Не целевой лид');
  const totalTimeLead = formatDate(dateContract || dateNoLead);
  const nameIndustry = getFieldValue(fields, 'Отрасль') || '';
  const nameProduct = getFieldValue(fields, 'Оборудование') || '';

  // Берем нужные даты
  const createdAtFormatted = formatDate(lead.created_at); // "2025.04.22 15:30"
  const dateFormatted = parseDate(createdAtFormatted);

  const date = new Date(lead.updated_at * 1000);
  const formattedUpdatedAt = `${date.toLocaleDateString('ru-RU')} ${date.toLocaleTimeString('ru-RU')}`;

  const serial = getLeadStatusData(leadStatusSerial);
  const engine = getLeadStatusData(leadStatusEngine);

  return {
    newLeadSource, // 4 D Источник сделки
    statusName, // 5 E Название статуса
    pipelineName, // 6 F Название воронки
    leadStatusNewRequest, // 7 G Создан
    leadStatusInProgress: findLeadInProgress, // 8 H ДатаВремя "ОМ Взято в работу"
    deltaMain, // 9 I Дельта Взято в работу - Создание ВРЕМЯ
    leader: leader ? leader.name : '', // 10 J Рук отдела
    serial, //11, 12, 13 K На серию. ДатаВремя "Время ОМ квал серия"
    engine, // 14, 15, 16 N Распределен на инжиниринг
    formattedUpdatedAt, // 19 W Дата/время последнего обновления в сделке
    reasonForRefusal, // X причина отказа
    totalTimeLead, // Z
    nameIndustry, // AA
    nameProduct, //AB
    dateFormatted, // Дата формата: 22 4 25,
    currentResponsible,
    leadLastClosed,
  };
};
