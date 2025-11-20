# Storage Layer

The storage layer provides a comprehensive data persistence framework for SEC (Securities and Exchange Commission) financial data. It implements a repository pattern with type-safe schemas and normalized data structures to handle complex relationships between entities, companies, persons, filings, and related information.

## Architecture Overview

### Core Patterns

- **Repository Pattern**: Each domain has a dedicated repository class that encapsulates data access logic
- **Type Safety**: Uses TypeBox schemas for runtime type validation and TypeScript type generation
- **Normalization**: Data is normalized to reduce redundancy and ensure consistency
- **Junction Tables**: Many-to-many relationships are modeled using junction tables
- **Dependency Injection**: Service registry pattern with tokens for loose coupling

### Key Concepts

- **CIK (Central Index Key)**: The primary identifier for SEC entities
- **Hash IDs**: Generated hash identifiers for normalized entities (addresses, persons, companies, phones)
- **Relation Names**: Contextual relationship descriptors (e.g., "form-d:offering")

## Storage Modules

### 📁 Entity (`entity/`)

**Core entity management and SEC identifiers**

- **Files**: `EntitySchema.ts`, `EntityRepo.ts`, `EntityTickerSchema.ts`, `SicCodeSchema.ts`, `CikNameSchema.ts`
- **Purpose**: Manages SEC entities with their CIK identifiers, stock tickers, SIC codes, and name mappings
- **Key Features**:
  - CIK-based entity identification
  - Stock ticker tracking with exchange information
  - SIC (Standard Industrial Classification) code management
  - Entity name history and variations

### 📁 Filing (`filing/`)

**SEC filing document storage**

- **Files**: `FilingSchema.ts`, `FilingSchema.test.ts`
- **Purpose**: Stores SEC filing documents and metadata
- **Key Features**:
  - Filing metadata storage
  - Accession number tracking
  - Form type categorization
  - Filing date management

### 📁 Address (`address/`)

**Normalized address management with relationships**

- **Files**: `AddressSchema.ts`, `AddressRepo.ts`, `AddressNormalization.ts`, `AddressSchemaCodes.ts`
- **Purpose**: Handles address storage with data normalization and entity relationships
- **Key Features**:
  - Address normalization and cleaning
  - Country/state code validation
  - Junction table for entity-address relationships
  - Hash-based deduplication

### 📁 Company (`company/`)

**Company information with name normalization**

- **Files**: `CompanySchema.ts`, `CompanyRepo.ts`, `CompanyNormalization.ts`
- **Purpose**: Manages company data with name standardization and historical tracking
- **Key Features**:
  - Company name normalization
  - Previous name tracking
  - Entity relationship management
  - Company search capabilities

### 📁 Person (`person/`)

**Individual person data with multi-entity relationships**

- **Files**: `PersonSchema.ts`, `PersonRepo.ts`, `PersonNormalization.ts`
- **Purpose**: Stores individual person information with relationships to entities, addresses, and phones
- **Key Features**:
  - Person identification and normalization
  - Multiple entity associations with titles/roles
  - Address and phone number linking
  - Name variation tracking

### 📁 Phone (`phone/`)

**Phone number normalization and entity linking**

- **Files**: `PhoneSchema.ts`, `PhoneRepo.ts`, `PhoneNormalization.ts`
- **Purpose**: Manages phone numbers with international formatting and entity relationships
- **Key Features**:
  - International phone number normalization
  - Entity relationship tracking
  - Standardized formatting

### 📁 Investment Offering (`investment-offering/`)

**Investment offering and issuer tracking**

- **Files**: `InvestmentOfferingSchema.ts`, `InvestmentOfferingRepo.ts`, `InvestmentOfferingHistorySchema.ts`, `IssuerSchema.ts`, `IssuerRepo.ts`
- **Purpose**: Manages investment offerings with historical tracking and issuer information
- **Key Features**:
  - Investment offering lifecycle tracking
  - Historical change management
  - Issuer relationship management
  - Offering status and metadata

### 📁 Portal (`portal/`)

**Crowdfunding portal and crowdfunding data**

- **Files**: `PortalSchema.ts`, `PortalRepo.ts`, `CrowdfundingSchema.ts`, `CrowdfundingRepo.ts`
- **Purpose**: Manages crowdfunding portals and related crowdfunding offerings
- **Key Features**:
  - Portal registration and status tracking
  - Crowdfunding offering management
  - Portal-specific reporting
  - Brand and operational status tracking

## Data Relationships

### Junction Table Pattern

The storage layer uses junction tables to model many-to-many relationships:

```typescript
// Example: Person-Entity relationship
PersonsEntityJunctionSchema = {
  relation_name: string,    // Context (e.g., "form-d:offering")
  cik: number,             // Entity identifier
  titles: string[],        // Roles (e.g., ["CEO", "Director"])
  person_hash_id: string   // Person identifier
}
```

### Core Relationships

```
Entity (CIK) ←→ Person (via PersonsEntityJunction)
Entity (CIK) ←→ Company (via CompaniesEntityJunction)
Entity (CIK) ←→ Address (via AddressesEntityJunction)
Entity (CIK) ←→ Phone (via PhonesEntityJunction)
Person ←→ Address (via PersonsAddressJunction)
Person ←→ Phone (via PersonsPhoneJunction)
```

```
Entity (CIK) → Filing (direct relationship)
Entity (CIK) → Investment Offering (direct relationship)
Entity (CIK) → Crowdfunding (direct relationship)
Entity (CIK) → Portal (direct relationship)
```

## Data Flow

### Normalization Process

1. **Raw Data Input**: External data sources provide entity information
2. **Normalization**: Data is cleaned and standardized using dedicated normalization functions
3. **Hash Generation**: Unique hash IDs are generated for normalized entities
4. **Relationship Mapping**: Junction tables establish connections between entities
5. **Storage**: Normalized data is persisted through repository interfaces

### Repository Access Pattern

```typescript
// Example: Saving a person with entity relationship
const personRepo = new PersonRepo();
const person = await personRepo.savePerson(rawPersonData);
await personRepo.saveRelatedEntity(person.person_hash_id, "form-d:offering", entityCik, [
  "CEO",
  "Director",
]);
```

## Dependency Injection

Each repository uses dependency injection tokens for loose coupling:

```typescript
// Service tokens for repositories
ENTITY_REPOSITORY_TOKEN;
ADDRESS_REPOSITORY_TOKEN;
PERSON_REPOSITORY_TOKEN;
// ... and more
```

Repositories can be injected with custom storage implementations or use the global service registry.

## Testing

Each module includes comprehensive test files:

- Unit tests for normalization functions
- Repository integration tests
- Schema validation tests
- Relationship integrity tests

## Usage Examples

### Entity Management

```typescript
const entityRepo = new EntityRepo();
const entity = await entityRepo.getEntity(1234567);
await entityRepo.saveEntityTicker(1234567, "AAPL", "NASDAQ");
```

### Address Handling

```typescript
const addressRepo = new AddressRepo();
const address = await addressRepo.saveAddress(rawAddressData);
await addressRepo.saveRelatedEntity(address.address_hash_id, "business", entityCik);
```

### Person Relationships

```typescript
const personRepo = new PersonRepo();
const person = await personRepo.savePersonRelatedEntity(personData, "form-d:issuer", entityCik, [
  "CEO",
]);
```

This storage layer provides a robust foundation for managing complex SEC financial data with proper normalization, relationship tracking, and type safety.
