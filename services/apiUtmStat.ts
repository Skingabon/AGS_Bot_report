// //Беру все из crm-leads
// import { Lead } from '../interfaces';
//
// const token = 'fhsdfhsdhfsd8';
// export function getLeadsUtm(): Promise<Lead[]> {
//   return fetch(`https://`, {
//     headers: {
//       Authorization: `Bearer ${token}`,
//     },
//   })
//     .then((res) => res.json())
//     .catch((error) => error.message); //пишу в том месте где вызываю функцию
// }
//
// export function postLeadUtm() {
//   return fetch(`https://`, {
//     method: 'POST',
//     headers: {
//       Authorization: `Bearer ${token}`,
//     },
//     body: JSON.stringify({}),
//   })
//     .then((res) => res.json())
//     .catch((error) => error.message); //пишу в том месте где вызываю функцию
// }
