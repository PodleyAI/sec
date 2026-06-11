/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Static, Type } from "typebox";
import { STATE_COUNTRY_CODE } from "../../../storage/address/AddressSchema";
import {
  CIK_TYPE,
  CITY_TYPE,
  EMAIL_TYPE,
  ENTITY_NAME_TYPE,
  PHONE_NUMBER_TYPE,
  SCHEMA_VERSION_TYPE,
  STREET_TYPE,
  STRING_150_TYPE,
  STRING_255_TYPE,
  TRUE_FALSE_LIST,
  ZIP_CODE_TYPE,
} from "../FormSchemaUtil";

export const CFPORTAL_SUBMISSION_TYPE = Type.Union([
  Type.Literal("CFPORTAL"),
  Type.Literal("CFPORTAL/A"),
  Type.Literal("CFPORTAL-W"),
]);

const YES_NO_TYPE = Type.Union([Type.Literal("Y"), Type.Literal("N")]);
const STRING_256_TYPE = Type.String({ maxLength: 256 });
const CCC_TYPE = Type.String({ minLength: 8, maxLength: 8 });
const FILE_NUMBER_TYPE = Type.String({ minLength: 1, maxLength: 17 });

const ADDRESS_TYPE = Type.Object({
  street1: STREET_TYPE,
  street2: Type.Optional(STREET_TYPE),
  city: CITY_TYPE,
  stateOrCountry: STATE_COUNTRY_CODE,
  zipCode: ZIP_CODE_TYPE,
});

const PERSON_NAME_TYPE = Type.Object({
  firstName: Type.Optional(STRING_150_TYPE),
  middleName: Type.Optional(STRING_150_TYPE),
  lastName: Type.Optional(STRING_150_TYPE),
  suffix: Type.Optional(STRING_150_TYPE),
});

const FILER_TYPE = Type.Object({
  filerCredentials: Type.Object({
    filerCik: CIK_TYPE,
    filerCcc: CCC_TYPE,
  }),
  fileNumber: Type.Optional(FILE_NUMBER_TYPE),
});

const FILER_INFO_TYPE = Type.Object({
  filer: FILER_TYPE,
  liveTestFlag: Type.Optional(Type.Union([Type.Literal("LIVE"), Type.Literal("TEST")])),
  flags: Type.Optional(
    Type.Object({
      confirmingCopyFlag: Type.Optional(TRUE_FALSE_LIST),
      returnCopyFlag: Type.Optional(TRUE_FALSE_LIST),
      overrideInternetFlag: Type.Optional(TRUE_FALSE_LIST),
    })
  ),
  contact: Type.Optional(
    Type.Object({
      contactName: Type.Optional(ENTITY_NAME_TYPE),
      contactPhone: Type.Optional(PHONE_NUMBER_TYPE),
      contactEmail: Type.Optional(EMAIL_TYPE),
    })
  ),
  notifications: Type.Optional(
    Type.Object({
      notificationEmail: Type.Optional(Type.Array(EMAIL_TYPE, { maxItems: 3 })),
    })
  ),
});

const HEADER_DATA = Type.Object({
  submissionType: CFPORTAL_SUBMISSION_TYPE,
  filerInfo: FILER_INFO_TYPE,
});

const OTHER_NAME_AND_URL_TYPE = Type.Object({
  otherNamesUsedPortal: Type.Optional(STRING_150_TYPE),
  webSiteOfPortal: Type.Optional(STRING_256_TYPE),
});

const IDENTIFYING_INFORMATION_TYPE = Type.Object({
  amendmentExplanation: Type.Optional(Type.String()),
  nameOfPortal: Type.Optional(ENTITY_NAME_TYPE),
  otherNamesAndWebsiteUrls: Type.Optional(
    Type.Array(OTHER_NAME_AND_URL_TYPE, { maxItems: 30 })
  ),
  irsEmployerIdNumber: Type.Optional(Type.String()),
  portalAddress: Type.Optional(ADDRESS_TYPE),
  mailingAddressDifferent: Type.Optional(TRUE_FALSE_LIST),
  portalMailingAddress: Type.Optional(ADDRESS_TYPE),
  otherOfficeLocationAddress: Type.Optional(ADDRESS_TYPE),
  portalContact: Type.Optional(
    Type.Object({
      portalContactPhone: Type.Optional(PHONE_NUMBER_TYPE),
      portalContactEmail: Type.Optional(EMAIL_TYPE),
    })
  ),
  contactEmployeeName: Type.Optional(PERSON_NAME_TYPE),
  contactEmployeeTitle: Type.Optional(STRING_255_TYPE),
  fiscalYearEnd: Type.Optional(Type.String()),
  anyPreviousRegistrations: Type.Optional(YES_NO_TYPE),
  secFileNumbers: Type.Optional(Type.Array(FILE_NUMBER_TYPE, { maxItems: 50 })),
  anyForeignRegistrations: Type.Optional(YES_NO_TYPE),
});

const FORM_OF_ORGANIZATION_TYPE = Type.Object({
  legalStatusForm: Type.Optional(Type.String()),
  legalStatusOtherDesc: Type.Optional(STRING_255_TYPE),
  jurisdictionOrganization: Type.Optional(STATE_COUNTRY_CODE),
  dateIncorporation: Type.Optional(Type.String()),
});

const SCHEDULE_A_PERSON_TYPE = Type.Object({
  fullLegalName: Type.Optional(ENTITY_NAME_TYPE),
  // DM = domestic entity, FE = foreign entity, NP = natural person
  entityType: Type.Optional(Type.String()),
  titleStatus: Type.Optional(Type.String()),
  dateOfTitleStatusAcquired: Type.Optional(Type.String()),
  ownershipCode: Type.Optional(Type.String()),
  controlPerson: Type.Optional(YES_NO_TYPE),
  crdNumber: Type.Optional(Type.String()),
  cikNumber: Type.Optional(CIK_TYPE),
});

const SCHEDULE_B_PERSON_TYPE = Type.Object({
  fullLegalName: Type.Optional(ENTITY_NAME_TYPE),
  entityType: Type.Optional(Type.String()),
  typeOfAmendment: Type.Optional(Type.String()),
  titleStatus: Type.Optional(Type.String()),
  dateOfTitleStatusAcquired: Type.Optional(Type.String()),
  ownershipCode: Type.Optional(Type.String()),
  controlPerson: Type.Optional(YES_NO_TYPE),
  crdNumber: Type.Optional(Type.String()),
  cikNumber: Type.Optional(CIK_TYPE),
});

const INVESTOR_FUNDS_CONTACT_TYPE = Type.Object({
  investorFundsContactName: Type.Optional(ENTITY_NAME_TYPE),
  investorFundsAddress: Type.Optional(ADDRESS_TYPE),
  investorFundsContactPhone: Type.Optional(PHONE_NUMBER_TYPE),
});

const FORM_DATA = Type.Object({
  identifyingInformation: Type.Optional(IDENTIFYING_INFORMATION_TYPE),
  formOfOrganization: Type.Optional(FORM_OF_ORGANIZATION_TYPE),
  successions: Type.Optional(Type.Unknown()),
  controlRelationships: Type.Optional(
    Type.Object({
      fullLegalNames: Type.Optional(
        Type.Object({
          fullLegalName: Type.Optional(Type.Array(Type.String(), { maxItems: 50 })),
        })
      ),
    })
  ),
  // Y/N disclosure battery (criminal / regulatory / civil / financial) and
  // related DRP sections: parsed through untouched, not consumed by storage.
  disclosureAnswers: Type.Optional(Type.Unknown()),
  nonSecuritiesRelatedBusiness: Type.Optional(Type.Unknown()),
  escrowArrangements: Type.Optional(
    Type.Object({
      investorFundsContacts: Type.Optional(
        Type.Array(INVESTOR_FUNDS_CONTACT_TYPE, { maxItems: 50 })
      ),
      compensationDesc: Type.Optional(Type.String()),
    })
  ),
  execution: Type.Optional(
    Type.Object({
      executionDate: Type.Optional(Type.String()),
      fullLegalNameFundingPortal: Type.Optional(ENTITY_NAME_TYPE),
      personSignature: Type.Optional(ENTITY_NAME_TYPE),
      personTitle: Type.Optional(STRING_255_TYPE),
    })
  ),
  scheduleA: Type.Optional(
    Type.Object({
      entityOrNaturalPerson: Type.Optional(
        Type.Array(SCHEDULE_A_PERSON_TYPE, { maxItems: 50 })
      ),
    })
  ),
  scheduleB: Type.Optional(
    Type.Object({
      amendEntityOrNaturalPerson: Type.Optional(
        Type.Array(SCHEDULE_B_PERSON_TYPE, { maxItems: 50 })
      ),
    })
  ),
});

export const FormCfportalSchema = Type.Object({
  schemaVersion: Type.Optional(SCHEMA_VERSION_TYPE),
  headerData: HEADER_DATA,
  formData: Type.Optional(FORM_DATA),
});

export type FormCfportal = Static<typeof FormCfportalSchema>;

export const FormCfportalSubmissionSchema = Type.Object({
  edgarSubmission: FormCfportalSchema,
});

export type FormCfportalSubmission = Static<typeof FormCfportalSubmissionSchema>;
