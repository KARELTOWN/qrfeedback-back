import { Router } from 'express';
import * as companyController from '../controllers/company.controller.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { companySlugValidator, registerCompanyValidator } from '../validators/company.validator.express.js';
import { handleValidation } from '../validators/validation.middleware.js';

const router = Router();

router.post('/register', registerCompanyValidator, handleValidation, asyncHandler(companyController.registerCompany));
router.get('/public/proof', asyncHandler(companyController.getPublicProof));
router.get('/:slug', companySlugValidator, handleValidation, asyncHandler(companyController.getPublicCompany));

export default router;
