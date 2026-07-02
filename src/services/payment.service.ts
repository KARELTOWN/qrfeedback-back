import { HttpError } from '../utils/httpError.js';

function paymentDisabled(): never {
  throw new HttpError(410, 'Les paiements sont desactives: Opinbase est gratuit.');
}

export async function createPayment() {
  paymentDisabled();
}

export async function createPaymentForCompany() {
  paymentDisabled();
}

export async function confirmPayment() {
  paymentDisabled();
}

export async function confirmPaymentReference() {
  paymentDisabled();
}

export async function confirmPaymentByProviderId() {
  paymentDisabled();
}
