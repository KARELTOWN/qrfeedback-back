import mongoose from 'mongoose';
import { connectDatabase } from '../config/database.js';
import { Company } from '../models/Company.js';
import { Review } from '../models/Review.js';

const legacyReviewFields = {
  customerName: '',
  customerPhone: '',
  improvementSuggestion: '',
  badExperience: ''
};

const legacyFeedbackFieldKeys = ['customerName', 'customerPhone', 'improvementSuggestion', 'badExperience'];

await connectDatabase();

const reviewsResult = await Review.updateMany(
  {},
  {
    $unset: legacyReviewFields
  }
);

const companiesResult = await Company.updateMany(
  {},
  {
    $pull: {
      'feedbackFormConfig.fields': {
        key: { $in: legacyFeedbackFieldKeys }
      }
    }
  }
);

console.log(`Reviews cleaned: ${reviewsResult.modifiedCount}`);
console.log(`Companies cleaned: ${companiesResult.modifiedCount}`);

await mongoose.disconnect();
