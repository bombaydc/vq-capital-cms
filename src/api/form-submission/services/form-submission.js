"use strict";
const yup = require("yup");
const { allowedCountryCodes } = require("../../../utility/country-code");
const {
  encryptRsa,
  decrptRsa,
  generateHash,
} = require("../../../utility/encryption");
// PII is persisted with AES-256-GCM, not the RSA ciphertext the browser sent.
// The RSA decrypt already happened in the controller (to validate the payload
// and build the notification email), so this costs nothing extra on write and
// makes the Leads export ~31,000x faster per field. See utility/pii-encryption.js.
const { encryptPii } = require("../../../utility/pii-encryption");
const { sendMail } = require("../../../utility/send-mail");
// const sfdcIntegration = require("../../../utility/sfdc-integration");

const fs = require("fs");
const path = require("path");

// Cached regex patterns for performance
const REGEX_CACHE = {
  email: /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/,
  pincode: /^[a-zA-Z0-9]*$/,
  countryCode: /^\+\d{1,4}$/,
  lettersOnly: /^[a-zA-Z\s]*$/,
  number: /^[0-9]+$/,
};

// File upload configuration
const FILE_CONFIG = {
  maxFileSize: 10 * 1024 * 1024, // 10MB
  allowedMimeTypes: [
    "image/jpeg",
    "image/png",
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ],
  allowedExtensions: ["jpg", "jpeg", "png", "pdf", "docx"],
};

async function validateSingleFile(
  file,
  allowedMimeTypes,
  allowedExtensions,
  allowedMaxFileSize,
  fileTypeFromBuffer
) {
  if (file.size > allowedMaxFileSize) {
    return { status: false, errors: "File size exceeds limit" };
  }

  const filePath = file.filepath || file.path;
  if (!filePath) {
    return { status: false, errors: "File path is missing" };
  }

  const normalizedPath = path.normalize(filePath);
  let fileBuffer;
  try {
    fileBuffer = fs.readFileSync(normalizedPath);
  } catch (error) {
    return { status: false, errors: "Failed to read file", er: error };
  }

  const detectedType = await fileTypeFromBuffer(fileBuffer);
  if (!detectedType || !allowedMimeTypes.includes(detectedType.mime)) {
    return { status: false, errors: "Invalid file type" };
  }

  const fileName = file.originalFilename || file.name || file.newFilename;
  if (!fileName) {
    return { status: false, errors: "File name is missing" };
  }
  const sanitizedFileName = fileName.replace(/[^a-zA-Z0-9.-]/g, "");
  const fileExtension = sanitizedFileName.split(".").pop().toLowerCase();
  if (!allowedExtensions.includes(fileExtension)) {
    return { status: false, errors: "Invalid file extension" };
  }

  return { status: true };
}

async function fileUpload(
  ctx,
  allowedMimeTypes = FILE_CONFIG.allowedMimeTypes,
  allowedExtensions = FILE_CONFIG.allowedExtensions,
  allowedMaxFileSize = FILE_CONFIG.maxFileSize
) {
  if (!ctx.request.files?.files) {
    return { status: false, errors: "No files provided" };
  }

  const { fileTypeFromBuffer } = await import("file-type");
  const { files } = ctx.request.files;

  const fileArray = Array.isArray(files) ? files : [files];

  for (const file of fileArray) {
    const res = await validateSingleFile(
      file,
      allowedMimeTypes,
      allowedExtensions,
      allowedMaxFileSize,
      fileTypeFromBuffer
    );
    if (!res.status) {
      return res;
    }
  }

  // Media-library folder id that form uploads land in (project-specific).
  const folderFk = process.env.FORM_UPLOAD_FOLDER_ID ? Number(process.env.FORM_UPLOAD_FOLDER_ID) : null;

  let uploadedFiles = [];
  try {
    // Process files one by one and upload each

    for (const file of fileArray) {
      const fileName = file.originalFilename || file.name || file.newFilename;

      try {
        // console.log(`[FILE-UPLOAD] Uploading file: ${fileName}`);

        // Upload using Strapi v5's upload service - similar to blog pattern
        const uploadResult = await strapi.plugin("upload").service("upload").upload({
          data: {
            fileInfo: {
              name: fileName,
              caption: fileName,
              alternativeText: fileName,
              folder: folderFk,
            },
          },
          files: file, // Pass single file object, not array
        });

        // console.log(`[FILE-UPLOAD] Upload successful for: ${fileName}`);

        // Handle both array and single file response
        const uploadedFile = Array.isArray(uploadResult) ? uploadResult[0] : uploadResult;
        uploadedFiles.push(uploadedFile);
      } catch (fileError) {
        // console.error(`[FILE-UPLOAD] Error uploading file ${fileName}:`, fileError.message);
        return { status: false, errors: `Error uploading ${fileName}` };
      }
    }

  } catch (error) {
    // console.error("[FILE-UPLOAD] Error during file upload process:", error);
    return { status: false, errors: "Error uploading files" };
  }

  if (!uploadedFiles || uploadedFiles.length === 0) {
    // console.error("[FILE-UPLOAD] No files were uploaded");
    return { status: false, errors: "No files to upload" };
  }

  // console.log(`[FILE-UPLOAD] Successfully uploaded ${uploadedFiles.length} file(s)`);
  return { status: true, uploadedfiles: uploadedFiles };
}

/**
 * Creates a nested error object from a Yup validation error.
 * @param {Object} yupError - The Yup validation error
 * @returns {Object} A nested object where each key is a field name and the value is an object with the same field name as the key and the value being the error message
 */
const createNestedErrorObject = (yupError) => {
  const nestedErrors = {};

  if (yupError && yupError.errors) {
    yupError.errors.forEach((error) => {
      const arr = Object.keys(error);
      const fieldName = arr[0];
      const fieldValue = error[fieldName];
      if (!nestedErrors[fieldName]) {
        nestedErrors[fieldName] = fieldValue;
      }
    });
  }

  return nestedErrors;
};

// Email validator
function createEmailValidator(field) {
  let validator = field.required
    ? yup.string().required({
      [field.name]: `Enter a valid ${(field?.title ?? "email address").toLowerCase()}.`,
    })
    : yup.string().nullable();

  return validator.test(
    "email",
    {
      [field.name]: `Enter a valid ${(field?.title ?? "email address").toLowerCase()}`,
    },
    (value) => !value || REGEX_CACHE.email.test(value)
  );
}

// Phone validator
function createPhoneValidator(field) {
  let validator = field.required
    ? yup.string().required({
      [field.name]: `Enter a valid ${(field?.title ?? "phone number").toLowerCase()}.`,
    })
    : yup.string().nullable();

  return validator.test(
    "mobile",
    { [field.name]: "Number must be between 5-15 digits." },
    function (value) {
      if (!value) return true;
      const countrycode = this.parent.countrycode;
      const number = parseInt(value);
      if (isNaN(number)) {
        return this.createError({
          path: this.path,
          message: {
            [field.name]:
              "Number must not include alphabets or special characters.",
          },
        });
      }
      const numString = String(value);
      if (
        countrycode == (field?.defaultCountry ?? 91) &&
        numString.length != (field?.defaultMobileLength ?? 10)
      ) {
        return this.createError({
          path: this.path,
          message: {
            [field.name]: `Enter a valid ${field?.defaultMobileLength ?? 10}-digit ${(field?.title ?? "phone number").toLowerCase()}.`,
          },
        });
      } else if (countrycode != (field?.defaultCountry ?? 91)) {
        return numString.length >= 5 && numString.length <= 15;
      }
      return true;
    }
  );
}

// Number validator
function createNumberValidator(field) {
  let validator = field.required
    ? yup
      .number()
      .typeError({ [field.name]: `${field.title} must be a number` })
      .required({ [field.name]: `${field.title} is required` })
    : yup
      .number()
      .typeError({ [field.name]: `${field.title} must be a number` })
      .nullable();

  return validator.test(
    "mobile",
    { [field.name]: "Number is not valid." },
    function (value) {
      if (!value) return true;
      const number = parseInt(value);
      if (isNaN(number)) {
        return this.createError({
          path: this.path,
          message: {
            [field.name]:
              "Number must not include alphabets or special characters.",
          },
        });
      }
      if (field?.min && number < field.min) {
        return this.createError({
          path: this.path,
          message: {
            [field.name]: `Number must be greater than ${field.min}.`,
          },
        });
      }
      if (field?.max && number > field.max) {
        return this.createError({
          path: this.path,
          message: { [field.name]: `Number must be less than ${field.max}.` },
        });
      }
      return true;
    }
  );
}

// Date validator
function createDateValidator(field) {
  let validator = field.required
    ? yup.string().required({ [field.name]: `${field.title} is required` })
    : yup.string().nullable();

  return validator.test(
    "validate-date",
    { [field.name]: `Invalid ${field.title}` },
    function (value) {
      if (!value) return true;
      const date = new Date(value);
      if (isNaN(date.getTime())) return false;

      if (field?.minDate) {
        let allowedAfterDate = new Date();
        allowedAfterDate.setDate(
          allowedAfterDate.getDate() + parseInt(field.minDate)
        );
        allowedAfterDate.setHours(0, 0, 0, 0);
        if (date < allowedAfterDate) {
          return this.createError({
            path: this.path,
            message: {
              [field.name]: `${field.title} must be greater than the or equal to ${field.minDate}.`,
            },
          });
        }
      }
      if (field?.maxDate) {
        let allowedBeforeDate = new Date();
        allowedBeforeDate.setDate(
          allowedBeforeDate.getDate() + parseInt(field.maxDate)
        );
        allowedBeforeDate.setHours(0, 0, 0, 0);
        if (date > allowedBeforeDate) {
          return this.createError({
            path: this.path,
            message: {
              [field.name]: `${field.title} must be less than the or equal to ${field.maxDate}.`,
            },
          });
        }
      }

      if (field?.exclude?.length > 0) {
        let days = {
          sunday: 0,
          monday: 1,
          tuesday: 2,
          wednesday: 3,
          thursday: 4,
          friday: 5,
          saturday: 6,
        };
        let day = date.getDay();
        const isExcludedDay = field.exclude.some(
          (element) => (days[element.toLowerCase()] ?? "na") === day
        );
        if (isExcludedDay) {
          return this.createError({
            path: this.path,
            message: {
              [field.name]: `${field.exclude.find((element) => (days[element.toLowerCase()] ?? "na") === day)} not allow`,
            },
          });
        }
      }
      return true;
    }
  );
}

// ============================================================================
// VALIDATOR FACTORY FUNCTIONS - Extracted to reduce cognitive complexity
// ============================================================================

/**
 * Resolves a pincode into its validation failure message, or null when valid.
 *
 * Pulled out of the yup test callback so that callback has a single return
 * shape. It previously mixed three types — bare `true`, bare `false`, and
 * `createError(...)` objects (SonarQube S3800), which also meant the regex
 * failure path silently used yup's default message while every other path
 * built its own. Returning `string | null` makes that uniform.
 *
 * @param {object} field
 * @param {string} value
 * @param {string|number} [countrycode] - sibling field value from `this.parent`
 * @returns {string|null} failure message, or null if the value is acceptable
 */
function resolvePincodeError(field, value, countrycode) {
  if (!REGEX_CACHE.pincode.test(value)) {
    return `${field.title} must be letters or numeric`;
  }

  const numString = String(value);

  // String-compare so a "91" sibling value still matches a numeric 91 default,
  // which the previous loose `==` relied on.
  const isDefaultCountry =
    String(countrycode) === String(field?.defaultCountry ?? 91);

  if (isDefaultCountry) {
    const datatype = field?.defaultDatatype ?? "number";
    const regex = {
      number: REGEX_CACHE.number,
      string: REGEX_CACHE.pincode,
    };

    if (!regex[datatype].test(value)) {
      return `${field.title} must be ${datatype}.`;
    }

    const expectedLength = field?.defaultZipcodeLength ?? 6;
    if (numString.length !== expectedLength) {
      const lengthUnit = datatype === "number" ? "digits" : "characters";
      return `${field.title} must be ${expectedLength} ${lengthUnit}.`;
    }
  } else if (numString.length < 3 || numString.length > 10) {
    // International pincode validation
    return `${field.title} must be between 3-10 characters.`;
  }

  // Check allowed pincodes list
  if (field?.allowed?.length > 0) {
    const allowedZipCodes = new Set(field.allowed.map((item) => item.value));
    if (!allowedZipCodes.has(value)) {
      return `Services not available for this ${field.title.toLowerCase()}.`;
    }
  }

  return null;
}

/**
 * Creates a pincode validator with country-specific rules
 */
function createPincodeValidator(field) {
  let validator = field.required
    ? yup.string().required({ [field.name]: `${field.title} is required` })
    : yup.string().nullable();

  return validator.test(
    "pincode-regex",
    { [field.name]: `${field.title} must be letters or numeric` },
    function (value) {
      if (!value) return true;

      const message = resolvePincodeError(field, value, this.parent?.countrycode);
      if (message) {
        throw this.createError({
          path: this.path,
          message: { [field.name]: message },
        });
      }

      return true;
    }
  );
}

/**
 * Validates minimum and maximum selection count
 */
function validateSelectionCount(field, selectedOptions, createError, path, name) {
  if (field?.minimumSelection && selectedOptions.length < field.minimumSelection) {
    const optionText = field.minimumSelection > 1 ? "options" : "option";
    return createError({
      path,
      message: { [name]: `Select at least ${field.minimumSelection} ${optionText}` },
    });
  }

  if (field?.maximumSelection && selectedOptions.length > field.maximumSelection) {
    const optionText = field.maximumSelection > 1 ? "options" : "option";
    return createError({
      path,
      message: { [name]: `Select at most ${field.maximumSelection} ${optionText}` },
    });
  }

  return null;
}

/**
 * Validates multiselect options including "other" option with regex
 */
function validateMultiselectOptions(field, selectedOptions, createError, path, name) {
  // Set rather than array: this is a pure membership test run once per selected
  // option, so lookups are O(1) instead of a linear scan per option (S7776).
  const validOptions = new Set(field.enum.map((option) => option.value));

  if (field?.otherOption && field?.regex) {
    const pattern = new RegExp(field.regex);
    for (const option of selectedOptions) {
      const trimmed = option.trim();
      if (!validOptions.has(trimmed) && !pattern.test(trimmed)) {
        return createError({
          path,
          message: { [name]: `${trimmed} must be letters.` },
        });
      }
    }
  } else {
    for (const option of selectedOptions) {
      if (!validOptions.has(option.trim())) {
        return false;
      }
    }
  }

  return true;
}

/**
 * Creates a multiselect validator with min/max selection and regex validation
 */
function createMultiselectValidator(field) {
  let validator = field.required
    ? yup.string().required({ [field.name]: `${field.title} is required` })
    : yup.string().nullable();

  return validator.test(
    "select",
    { [field.name]: `Invalid ${field.title}.` },
    function (value) {
      if (!value) return true;

      // Check selection count (comma-space separated)
      let selectedOptions = value.split(", ");
      const countError = validateSelectionCount(field, selectedOptions, this.createError, this.path, field.name);
      if (countError) return countError;

      // Validate options (comma separated without space)
      selectedOptions = value.split(",");
      return validateMultiselectOptions(field, selectedOptions, this.createError, this.path, field.name);
    }
  );
}

/**
 * Creates a select validator (single selection)
 */
function createSelectValidator(field) {
  let validator = field.required
    ? yup.string().required({ [field.name]: `${field.title} is required` })
    : yup.string().nullable();

  if (field?.otherOption) {
    return validator.test(
      "select-regex",
      { [field.name]: `${field.title} must be letters` },
      function (value) {
        if (!value) return true;
        const pattern = field?.regex ? new RegExp(field.regex) : REGEX_CACHE.lettersOnly;
        return pattern.test(value);
      }
    );
  }

  return validator.test(
    "select",
    { [field.name]: `Invalid ${field.title}.` },
    (value) => {
      if (!value) return true;
      const validOptions = field.enum.map((option) => option.value.toString());
      return validOptions.includes(value);
    }
  );
}

/**
 * Validates length constraints (min/max)
 */
function validateLength(field, value, createError, path, name) {
  if (field?.minLength && value.length < field.minLength) {
    const message = field?.maxLength
      ? `${field.title} must be between ${field.minLength}-${field.maxLength} characters.`
      : `${field.title} must be at least ${field.minLength} characters`;
    return createError({ path, message: { [name]: message } });
  }

  if (field?.maxLength && value.length > field.maxLength) {
    const message = field?.minLength
      ? `${field.title} must be between ${field.minLength}-${field.maxLength} characters.`
      : `${field.title} must be at most ${field.maxLength} characters`;
    return createError({ path, message: { [name]: message } });
  }

  return null;
}

/**
 * Validates custom patterns from field configuration
 */
function validateCustomPatterns(field, value, createError, path, name) {
  if (field?.validation?.pattern?.length > 0) {
    for (const patternObj of field.validation.pattern) {
      if (!value.match(new RegExp(patternObj.value))) {
        return createError({
          path,
          message: { [name]: patternObj.message },
        });
      }
    }
  }
  return null;
}

/**
 * Creates a text field validator with length and pattern validation
 */
function createTextValidator(field) {
  let validator = field.required
    ? yup.string().required({ [field.name]: `${field.title} is required` })
    : yup.string().nullable();

  return validator.test(
    "textarea",
    { [field.name]: `${field.title} must be letters and spaces characters are allowed.` },
    function (value) {
      if (!value) return true;

      const lengthError = validateLength(field, value, this.createError, this.path, field.name);
      if (lengthError) return lengthError;

      const patternError = validateCustomPatterns(field, value, this.createError, this.path, field.name);
      if (patternError) return patternError;

      return true;
    }
  );
}

/**
 * Creates a textarea validator with length and pattern validation
 */
function createTextareaValidator(field) {
  let validator = field.required
    ? yup.string().required({ [field.name]: `${field.title} is required` })
    : yup.string().nullable();

  return validator.test(
    "textarea",
    { [field.name]: `${field.title} must be letters, numbers, spaces, and . - ! ( ) , & and % characters are allowed.` },
    function (value) {
      if (!value) return true;

      const lengthError = validateLength(field, value, this.createError, this.path, field.name);
      if (lengthError) return lengthError;

      const patternError = validateCustomPatterns(field, value, this.createError, this.path, field.name);
      if (patternError) return patternError;

      return true;
    }
  );
}

/**
 * Creates a radio button validator
 */
function createRadioValidator(field) {
  let validator = field.required
    ? yup.string().required({ [field.name]: `${field.title} is required` })
    : yup.string().nullable();

  const validOptions = field.enum.map((option) => option.value);
  return validator.test(
    "radio",
    { [field.name]: `Invalid ${field.title}.` },
    (value) => !value || validOptions.includes(value)
  );
}

/**
 * Creates a checkbox validator (multiple selection)
 */
function createCheckboxValidator(field) {
  let validator = field.required
    ? yup.array()
        .typeError({ [field.name]: `${field.title} is not valid format.` })
        .required({ [field.name]: `${field.title} is required` })
    : yup.array().nullable();

  const validOptions = field.enum.map((option) => option.value);
  return validator.test(
    "checkbox",
    { [field.name]: `Invalid ${field.title}.` },
    (value) => !value || validOptions.every((option) => value.includes(option))
  );
}

/**
 * Creates a boolean checkbox validator
 */
function createCheckboxBooleanValidator(field) {
  let validator = field.required
    ? yup.string().required({ [field.name]: `${field.title} is required` })
    : yup.string().nullable();

  const validOptions = field?.available_values ?? [];
  return validator.test(
    "checkbox",
    { [field.name]: `Invalid ${field.title}.` },
    (value) => !value || validOptions.includes(value)
  );
}

/**
 * Creates a consent validator (must be true)
 */
function createConsentValidator(field) {
  return yup
    .boolean()
    .required({ [field.name]: `${field.title} is required` })
    .test(
      "consent-accepted",
      { [field.name]: `You must accept ${field.title.toLowerCase()}` },
      (value) => value === true
    );
}

/**
 * Map of field types to their validator factory functions
 */
const VALIDATOR_FACTORIES = {
  email: createEmailValidator,
  tel: createPhoneValidator,
  number: createNumberValidator,
  "pincode-type": createPincodeValidator,
  date: createDateValidator,
  multiselect: createMultiselectValidator,
  select: createSelectValidator,
  country_select: (field) => {
    let validator = field.required
      ? yup.string().required({ [field.name]: `${field.title} is required` })
      : yup.string().nullable();
    return validator.oneOf(allowedCountryCodes, { countrycode: "Invalid country code" });
  },
  text: createTextValidator,
  textarea: createTextareaValidator,
  radio: createRadioValidator,
  checkbox: createCheckboxValidator,
  checkbox_boolean: createCheckboxBooleanValidator,
  consent: createConsentValidator,
};

// ============================================================================
// MAIN SCHEMA BUILDER - Now with reduced cognitive complexity
// ============================================================================

function dynamicYupSchema(formStructure) {
  const shape = {};

  for (const key in formStructure) {
    if (!Object.hasOwn(formStructure, key)) continue;

    const field = formStructure[key];
    if (field?.isFormContent) continue;

    // Use factory function if available for this field type
    const validatorFactory = VALIDATOR_FACTORIES[field.type];
    if (validatorFactory) {
      shape[key] = validatorFactory(field);
    }
  }

  return shape;
}


/**
 * form-submission service
 */

module.exports = () => ({

  /**
   * Validates form data against a schema and handles rate limiting
   * @param {Object} ctx - The context object containing request information
   * @param {Object} formData - The form data to validate
   * @param {Object} formStructureSchema - The schema to validate against
   * @returns {Object} Validation result with status and message
   */
  validateForm: async (ctx, formData, formStructureSchema, isRateLimitCheck = true) => {
    // Rate limiting check (basic implementation)
    if (isRateLimitCheck) {
      const clientIP = ctx.request.ip;
      const now = Date.now();
      if (!global.rateLimitCache) global.rateLimitCache = new Map();

      const lastRequest = global.rateLimitCache.get(clientIP);
      if (lastRequest && now - lastRequest < 1000) {
        // 1 second rate limit
        console.error(`[SECURITY] Rate limit exceeded for IP: ${clientIP}`);
        return {
          status: false,
          message: "Too many requests. Please try again later.",
        };
      }
      global.rateLimitCache.set(clientIP, now);
    }

    let shape = dynamicYupSchema(formStructureSchema);

    shape.ipaddress = yup.string().nullable();
    shape.referer_url = yup.string().nullable();
    shape.page_url = yup.string().nullable();

    const formSchema = yup.object().shape(shape);
    try {
      await formSchema.validate(formData, { abortEarly: false });
    } catch (error) {
      console.error(error.errors, error.value); // Log the full error to see its structure
      const mappedErrors = createNestedErrorObject(error);
      return {
        status: false,
        message: "Validation error occured.",
        formerror: mappedErrors,
      };
    }

    // file type validation handle here
    let fileUploadResult;
    return {
      status: true,
      message: "Successfully Submitted",
      fileUploadResult: fileUploadResult,
    };
  },
  validateFileUpload: async (ctx, formFileTypeSchema) => {
    // console.log("[VALIDATE-FILE] Starting file validation");
    // console.log("[VALIDATE-FILE] ctx.request.files exists:", !!ctx.request.files);
    // console.log("[VALIDATE-FILE] ctx.request.files keys:", Object.keys(ctx.request.files || {}));
    // console.log("[VALIDATE-FILE] formFileTypeSchema:", formFileTypeSchema);

    // Implement file upload validation logic here
    // file type validation handle here
    let fileUploadResult;
    let allowMimeTypes = formFileTypeSchema?.allowed_mime_types ?? ["image/jpeg", "image/png", "application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"];
    let allowExtensions = formFileTypeSchema?.allowed_extensions ?? ["jpg", "jpeg", "png", "pdf", "docx"];
    let allowMaxFileSize = formFileTypeSchema?.max_size_mb ? formFileTypeSchema?.max_size_mb * 1024 * 1024 : FILE_CONFIG.maxFileSize; //in bytes

    const { files } = ctx.request.files || {};
    // console.log("[VALIDATE-FILE] files extracted:", !!files);
    // console.log("[VALIDATE-FILE] files value:", files);

    if (files) {
      // console.log("[VALIDATE-FILE] Files found, calling fileUpload function");
      try {
        fileUploadResult = await fileUpload(ctx, allowMimeTypes, allowExtensions, allowMaxFileSize);
        // console.log("[VALIDATE-FILE] fileUpload result:", fileUploadResult);
        // console.log("fileupload done? ", fileUploadResult);
        if (!fileUploadResult.status) {
          // console.error("[VALIDATE-FILE] Upload validation failed:", fileUploadResult.errors);
          return {
            status: false,
            message: "Validation error occured.",
            errors: [{ files: fileUploadResult.errors }],
          };
        }
        return {
          status: true,
          message: "Successfully Submitted",
          uploadedfiles: fileUploadResult.uploadedfiles,
        };
      } catch (errors) {
        console.error("[VALIDATE-FILE] Error during file upload:", errors);
        return { status: false, message: "Validation error occured.", errors: errors };
      }
    } else {
      // console.log("[VALIDATE-FILE] No files found in request");
    }

    return {
      status: false,
      message: "No files provided",
      errors: [{ files: "No files provided" }],
    }
  },
  /**
  * store Contact in the database and sends notification email
  * @param {Object} formData - The raw form data
  * @param {Object} decrptedFormData - The decrypted form data
  * @param {String} emails - Results from any string
  * @returns {Object} Storage result with status and message
  */
  storeContactForm: async (formData, decrptedFormData, emails = '') => {
    // Store form data in the database
    try {
      const data = {
        "name": encryptPii(decrptedFormData?.name),
        "email": encryptPii(decrptedFormData?.email),
        "mobile": encryptPii(decrptedFormData?.mobile),
        "country_code": decrptedFormData?.countrycode ?? null,
        'city': decrptedFormData?.city ?? null,
        'type': decrptedFormData?.type ?? null,
        "query_type": decrptedFormData?.query_type ?? null,
        "message": decrptedFormData?.message ?? null,
        "ipaddress": decrptedFormData?.ipaddress ?? null,
        "referer_url": decrptedFormData?.referer_url ?? null,
        "page_url": decrptedFormData?.page_url ?? null,
        // "consent": (decrptedFormData?.consent ?? false) === true ? true : false,
      }
      data.email_hash = generateHash(decrptedFormData?.email ?? "");
      data.mobile_hash = generateHash(decrptedFormData?.mobile ?? "");

      // data.sfdc_submit = "false";

      // Submit to SFDC and wait for result before creating entry
      try {
        // const sfdcResult = await sfdcIntegration.submitLeadAsync(decrptedFormData);
        // data.sfdc_submit = sfdcResult;
      } catch (sfdcError) {
        // console.error("[SFDC] Error in contact form submission:", sfdcError);
        // data.sfdc_submit = "false";
      }

      const entry = await strapi.documents("api::lead-contact.lead-contact").create({ data, status: 'published' });
      // console.log("Entry: ", entry);
      // send mail to admin
      const mappedEmails = emails.split(',').map(email => email.trim()).filter(email => email.length > 0);
      if (entry && mappedEmails && mappedEmails.length > 0) {
        // form details email template
        const emailData = {
          "Lead Type": decrptedFormData.type || '',
          Name: decrptedFormData.name || '',
          Email: decrptedFormData.email || '',
          Phone: decrptedFormData?.mobile ? (decrptedFormData.countrycode ?? '') + ' ' + (decrptedFormData.mobile ?? '') : '',
          city: decrptedFormData.city || '',
          "Query Type": decrptedFormData.query_type || '',
          Message: decrptedFormData.message || '',
          "Referer URL": decrptedFormData.referer_url || '',
          "Page URL": decrptedFormData.page_url || '',
          // "Consent": decrptedFormData?.consent ? 'Accepted' : 'Not Accepted',
        };
        // console.log("Contact form email data:", emailData);
        for (const toEmail of mappedEmails) {
          await sendMail({
            to: toEmail,
            template: "contact",
            subject: 'New Contact Form Submission',
            html: '', // You can generate HTML content from emailData if needed
          }, emailData);
        }
        //console.log("Sending email with data:", emailData, entry);
      }
      return { status: true, message: "Form data stored successfully", data: entry };
    } catch (error) {
      console.error("Error storing form data:", error);
      return { status: false, message: "Error storing form data", error };
    }
  },
});
