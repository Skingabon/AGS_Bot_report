import { Lead } from '../interfaces';
import {
  formatDate,
  formatDiff,
  getFieldValue,
  parseCustomDate,
} from '../helper';

export const getStatusLead = (lead: Lead): string => {
  let statusName = '';
  if (lead.status_id === 142) {
    statusName = 'Успешно реализовано';
  } else if (lead.status_id === 143) {
    statusName = 'Закрыто и не реализовано';
  }
  if (lead.status_id === 18913120) {
    statusName = 'Отдел серийного об-я';
  }
  if (lead.status_id === 73470054) {
    statusName = 'Отдел инжиниринга ';
  }

  return statusName;
};

type getParamsLeadType = {
  lead: Lead;
  pipelinesMap: { [p: number]: string };
};

export const getParamsLead = ({ lead, pipelinesMap }: getParamsLeadType) => {
  const pipelineName = pipelinesMap[lead.pipeline_id] || 'Не найдено';

  // Добавляем название статуса в зависимости от ID статуса
  //Заменить на switch case
  const statusName = getStatusLead(lead);

  //новые поля
  const fields = lead.custom_fields_values || [];
  const newLeadSourse = getFieldValue(fields, 'Источник лида') || '';
  const reasonForRefusal = getFieldValue(fields, 'Причина отказа') || '';
  // const newLeadTime = formatDate(
  //   getFieldValue(fields, 'Дата/время новая заявка'),
  // );
  // const newLeadAdmin = getFieldValue(fields, 'ОМ Новая заявка') || '';
  const dateContract = getFieldValue(fields, 'Дата Договор заключен');
  const dateNoLead = getFieldValue(fields, 'Дата Не целевой лид');

  const totalTimeLead = formatDate(dateContract || dateNoLead);

  const nameIndustry = getFieldValue(fields, 'Отрасль') || '';
  const nameProduct = getFieldValue(fields, 'Оборудование') || '';

  const omTakenAt = formatDate(
    getFieldValue(fields, 'Дата/время взято в работу'),
  ); // Форматируем сразу
  const omTakenBy = getFieldValue(fields, 'ОМ Взято в работу') || '';

  const omAssignedAt = formatDate(getFieldValue(fields, 'Время ОМ квал серия'));
  const omAssignedBy = getFieldValue(fields, 'ОМ Квал серия') || '';
  const omTakenByIng = getFieldValue(fields, 'ОМ Квал инж') || '';
  const omRaspredByIng = getFieldValue(fields, 'Распр ОМ квал ИНЖ') || '';
  const omRaspredByIngTime = formatDate(
    getFieldValue(fields, 'Время Распр ОМ квал ИНЖ'),
  );
  const omTakeIng = formatDate(getFieldValue(fields, 'Дата/время КВАЛ инж'));

  // Берем нужные даты
  const createdDate = new Date(lead.created_at * 1000);
  const createdAtFormatted = formatDate(lead.created_at); // "2025.04.22 15:30"
  const takenDate = omTakenAt ? parseCustomDate(omTakenAt) : null; // Парсим обратно, если нужно
  const takeIngDate = omTakeIng ? parseCustomDate(omTakeIng) : null;
  const assignedDate = omAssignedAt ? parseCustomDate(omAssignedAt) : null;

  // Вычисляем разницу
  let diffCreatedToTaken = '';
  if (takenDate && !isNaN(takenDate.getTime())) {
    const diffMs = takenDate.getTime() - createdDate.getTime();
    diffCreatedToTaken = formatDiff(diffMs);
  }

  let diffTakenToTakeIng: string;
  if (
    takenDate &&
    takeIngDate &&
    !isNaN(takenDate.getTime()) &&
    !isNaN(takeIngDate.getTime())
  ) {
    const diffMs = takeIngDate.getTime() - takenDate.getTime();

    diffTakenToTakeIng = formatDiff(diffMs);
  } else {
    diffTakenToTakeIng = '';
  }

  let diffAssignedToTaken = '';
  if (
    takenDate &&
    assignedDate &&
    !isNaN(takenDate.getTime()) &&
    !isNaN(assignedDate.getTime())
  ) {
    const diffMs = assignedDate.getTime() - takenDate.getTime();
    diffAssignedToTaken = formatDiff(diffMs);
  }

  // Разница между распределением на инженера и тем, когда рук отдела взял в работу
  let diffIngRukManeger = '';
  const raspredIngDate = omRaspredByIngTime
    ? parseCustomDate(omRaspredByIngTime)
    : null;
  const takeIngDateForDiff = omTakeIng ? parseCustomDate(omTakeIng) : null;

  if (
    raspredIngDate &&
    takeIngDateForDiff &&
    !isNaN(raspredIngDate.getTime()) &&
    !isNaN(takeIngDateForDiff.getTime())
  ) {
    const diffMs = takeIngDateForDiff.getTime() - raspredIngDate.getTime();
    diffIngRukManeger = formatDiff(diffMs);
  }

  const date = new Date(lead.updated_at * 1000);
  const formattedUpdatedAt = `${date.toLocaleDateString('ru-RU')} ${date.toLocaleTimeString('ru-RU')}`;
  // Сортирую по возрастанию даты создания
  // if (isCreate) {
  //   leads.sort((a, b) => a.created_at - b.created_at);
  // }

  return {
    newLeadSourse, // 4 D Источник сделки
    statusName, // 5 E Название статуса
    pipelineName, // 6 F Название воронки
    createdAtFormatted, // 7 G Создан
    omTakenAt, // 8 H ДатаВремя "ОМ Взято в работу"
    diffCreatedToTaken, // 9 I Дельта Взято в работу - Создание ВРЕМЯ
    omTakenBy, // 10 J Рук отдела Менеджер "ОМ Взято в работу"
    omAssignedAt, //11 K На серию. ДатаВремя "Время ОМ квал серия"
    diffAssignedToTaken, // 12 L Дельта На серию - Взято в работу  ВРЕМЯ
    omAssignedBy, // 13 M Менеджер Серии "ОМ Квал серия"
    omTakeIng, // 14 N Распределен на инжиниринг
    diffTakenToTakeIng, //15 O На инж - Взято в работу
    omTakenByIng, // 16 Р Кто распределил наинжиниринг "ОМ Квал ИНЖ"
    omRaspredByIngTime, // 17 Q Время распределения на менеджера инжиниринга "Время Распр ОМ квал ИНЖ"
    diffIngRukManeger, // 18 R  Дельта распредления Кто распределил на менеджера
    omRaspredByIng,
    formattedUpdatedAt, // 19 W Дата/время последнего обновления в сделке
    reasonForRefusal, // X причина отказа
    totalTimeLead, // Z
    nameIndustry, // AA
    nameProduct, //AB
  };
};
