export interface MockFactoryDefinition {
    paramName: string
    typeName: string
    decoratorType?: 'typeorm_repository' | 'mongoose_model' | 'cache_manager' | 'config_service' | 'automapper' | 'generic'
    entityOrToken?: string
    mockVariableName: string
    mockFactoryCode: string
    providerDefinition: string
    requiredImports: string[]
}

export class MockFactoryGenerator {
    /**
     * Inspects parameter decorators and types to generate standard, type-safe NestJS mock fixtures.
     */
    public static generateFactory(
        paramName: string,
        typeName: string,
        decorators: { name: string; args: string[] }[],
        methodsCalled: string[]
    ): MockFactoryDefinition {
        // 1. TypeORM Repository (@InjectRepository(Entity))
        const repoDec = decorators.find(d => d.name === 'InjectRepository')
        if (repoDec || typeName.includes('Repository')) {
            const entity = repoDec && repoDec.args[0] ? repoDec.args[0] : typeName.replace('Repository', '') || 'unknown'
            return this.buildTypeOrmRepoMock(paramName, typeName, entity, methodsCalled)
        }

        // 2. Mongoose Model (@InjectModel(Model.name))
        const modelDec = decorators.find(d => d.name === 'InjectModel')
        if (modelDec || typeName.includes('Model')) {
            const model = modelDec && modelDec.args[0] ? modelDec.args[0] : typeName.replace('Model', '') || 'unknown'
            return this.buildMongooseModelMock(paramName, typeName, model, methodsCalled)
        }

        // 3. Cache Manager (@Inject(CACHE_MANAGER) or Cache)
        const cacheDec = decorators.find(d => d.args.some(a => a.includes('CACHE_MANAGER')))
        if (cacheDec || typeName === 'Cache' || typeName.toLowerCase().includes('cachemanager')) {
            return this.buildCacheManagerMock(paramName, typeName, methodsCalled)
        }

        // 4. ConfigService
        if (typeName === 'ConfigService' || typeName.includes('ConfigService')) {
            return this.buildConfigServiceMock(paramName, typeName, methodsCalled)
        }

        // 5. AutoMapper
        const mapperDec = decorators.find(d => d.name.includes('Mapper') || d.args.some(a => a.toLowerCase().includes('mapper')))
        if (mapperDec || typeName.toLowerCase().includes('mapper')) {
            return this.buildAutoMapperMock(paramName, typeName, methodsCalled)
        }

        // 6. Generic Service Mock
        return this.buildGenericServiceMock(paramName, typeName, methodsCalled)
    }

    private static buildTypeOrmRepoMock(
        paramName: string,
        typeName: string,
        entity: string,
        methodsCalled: string[]
    ): MockFactoryDefinition {
        const mockVar = `mock${entity}Repository`
        const standardMethods = new Set(['find', 'findOne', 'findOneBy', 'create', 'save', 'update', 'delete', 'remove', ...methodsCalled])
        
        const methodStubs: string[] = []
        standardMethods.forEach(m => {
            const lower = m.toLowerCase()
            if (lower.includes('find') && (lower.includes('one') || lower.includes('by'))) {
                methodStubs.push(`${m}: jest.fn().mockResolvedValue({ id: 1 } as unknown)`)
            } else if (lower.includes('find') || lower.includes('all')) {
                methodStubs.push(`${m}: jest.fn().mockResolvedValue([{ id: 1 }] as unknown)`)
            } else if (lower.includes('save') || lower.includes('create') || lower.includes('update')) {
                methodStubs.push(`${m}: jest.fn().mockImplementation((val: unknown) => Promise.resolve({ id: 1, ...(typeof val === 'object' && val !== null ? val : {}) }))`)
            } else if (lower.includes('delete') || lower.includes('remove')) {
                methodStubs.push(`${m}: jest.fn().mockResolvedValue({ affected: 1 } as unknown)`)
            } else if (lower.includes('builder')) {
                methodStubs.push(`${m}: jest.fn().mockReturnValue({ where: jest.fn().mockReturnThis(), andWhere: jest.fn().mockReturnThis(), getOne: jest.fn().mockResolvedValue({ id: 1 }), getMany: jest.fn().mockResolvedValue([]) })`)
            } else {
                methodStubs.push(`${m}: jest.fn().mockResolvedValue({} as unknown)`)
            }
        })

        const mockFactoryCode = `const ${mockVar} = {\n    ${methodStubs.join(',\n    ')}\n} as unknown as Repository<${entity}>;`
        const providerDefinition = `{ provide: getRepositoryToken(${entity}), useValue: ${mockVar} }`

        return {
            paramName,
            typeName,
            decoratorType: 'typeorm_repository',
            entityOrToken: entity,
            mockVariableName: mockVar,
            mockFactoryCode,
            providerDefinition,
            requiredImports: ['getRepositoryToken', 'Repository']
        }
    }

    private static buildMongooseModelMock(
        paramName: string,
        typeName: string,
        model: string,
        methodsCalled: string[]
    ): MockFactoryDefinition {
        const mockVar = `mock${model.replace(/[^a-zA-Z0-9]/g, '')}Model`
        const standardMethods = new Set(['find', 'findById', 'findOne', 'create', 'save', 'exec', ...methodsCalled])

        const methodStubs: string[] = []
        standardMethods.forEach(m => {
            const lower = m.toLowerCase()
            if (lower.includes('find')) {
                methodStubs.push(`${m}: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([{ id: '1' }]) })`)
            } else if (lower.includes('create') || lower.includes('save')) {
                methodStubs.push(`${m}: jest.fn().mockImplementation((val: unknown) => Promise.resolve({ id: '1', ...(typeof val === 'object' && val !== null ? val : {}) }))`)
            } else {
                methodStubs.push(`${m}: jest.fn().mockResolvedValue({} as unknown)`)
            }
        })

        const mockFactoryCode = `const ${mockVar} = {\n    ${methodStubs.join(',\n    ')}\n};`
        const providerDefinition = `{ provide: getModelToken(${model}), useValue: ${mockVar} }`

        return {
            paramName,
            typeName,
            decoratorType: 'mongoose_model',
            entityOrToken: model,
            mockVariableName: mockVar,
            mockFactoryCode,
            providerDefinition,
            requiredImports: ['getModelToken']
        }
    }

    private static buildCacheManagerMock(
        paramName: string,
        typeName: string,
        methodsCalled: string[]
    ): MockFactoryDefinition {
        const mockVar = 'mockCacheManager'
        const standardMethods = new Set(['get', 'set', 'del', 'reset', ...methodsCalled])

        const methodStubs: string[] = []
        standardMethods.forEach(m => {
            if (m === 'get') {
                methodStubs.push(`${m}: jest.fn().mockResolvedValue(null)`)
            } else {
                methodStubs.push(`${m}: jest.fn().mockResolvedValue(undefined)`)
            }
        })

        const mockFactoryCode = `const ${mockVar} = {\n    ${methodStubs.join(',\n    ')}\n};`
        const providerDefinition = `{ provide: CACHE_MANAGER, useValue: ${mockVar} }`

        return {
            paramName,
            typeName,
            decoratorType: 'cache_manager',
            mockVariableName: mockVar,
            mockFactoryCode,
            providerDefinition,
            requiredImports: ['CACHE_MANAGER']
        }
    }

    private static buildConfigServiceMock(
        paramName: string,
        typeName: string,
        methodsCalled: string[]
    ): MockFactoryDefinition {
        const mockVar = 'mockConfigService'
        const standardMethods = new Set(['get', 'getOrThrow', ...methodsCalled])

        const methodStubs: string[] = []
        standardMethods.forEach(m => {
            methodStubs.push(`${m}: jest.fn().mockImplementation((key: string, defaultVal: unknown) => defaultVal ?? 'test-config-value')`)
        })

        const mockFactoryCode = `const ${mockVar} = {\n    ${methodStubs.join(',\n    ')}\n} as unknown as ConfigService;`
        const providerDefinition = `{ provide: ConfigService, useValue: ${mockVar} }`

        return {
            paramName,
            typeName,
            decoratorType: 'config_service',
            mockVariableName: mockVar,
            mockFactoryCode,
            providerDefinition,
            requiredImports: ['ConfigService']
        }
    }

    private static buildAutoMapperMock(
        paramName: string,
        typeName: string,
        methodsCalled: string[]
    ): MockFactoryDefinition {
        const mockVar = 'mockMapper'
        const standardMethods = new Set(['map', 'mapArray', 'mapArrayAsync', 'mapAsync', ...methodsCalled])

        const methodStubs: string[] = []
        standardMethods.forEach(m => {
            if (m === 'map') {
                methodStubs.push(`map: jest.fn().mockImplementation((val: unknown) => val)`)
            } else if (m.includes('Array')) {
                methodStubs.push(`${m}: jest.fn().mockImplementation((arr: unknown[]) => arr || [])`)
            } else {
                methodStubs.push(`${m}: jest.fn().mockImplementation((val: unknown) => Promise.resolve(val))`)
            }
        })

        const mockFactoryCode = `const ${mockVar} = {\n    ${methodStubs.join(',\n    ')}\n};`
        const providerDefinition = `{ provide: getMapperToken(), useValue: ${mockVar} }`

        return {
            paramName,
            typeName,
            decoratorType: 'automapper',
            mockVariableName: mockVar,
            mockFactoryCode,
            providerDefinition,
            requiredImports: ['getMapperToken']
        }
    }

    private static buildGenericServiceMock(
        paramName: string,
        typeName: string,
        methodsCalled: string[]
    ): MockFactoryDefinition {
        const mockVar = `mock${typeName.replace(/[^a-zA-Z0-9]/g, '')}`
        const methodStubs = methodsCalled.map(m => {
            const lower = m.toLowerCase()
            if (lower.includes('find') || lower.includes('get') || lower.includes('all')) {
                return `${m}: jest.fn().mockResolvedValue([{ id: 1 }] as unknown)`
            }
            if (lower.includes('exist') || lower.includes('has') || lower.includes('is')) {
                return `${m}: jest.fn().mockResolvedValue(false)`
            }
            if (lower.includes('create') || lower.includes('save') || lower.includes('update')) {
                return `${m}: jest.fn().mockImplementation((val: unknown) => Promise.resolve({ id: 1, ...(typeof val === 'object' && val !== null ? val : {}) }))`
            }
            return `${m}: jest.fn().mockResolvedValue({} as unknown)`
        })

        const body = methodStubs.length > 0 ? methodStubs.join(',\n    ') : '// No direct calls detected'
        const mockFactoryCode = `const ${mockVar} = {\n    ${body}\n} as unknown as ${typeName};`
        const providerDefinition = `{ provide: ${typeName}, useValue: ${mockVar} }`

        return {
            paramName,
            typeName,
            decoratorType: 'generic',
            mockVariableName: mockVar,
            mockFactoryCode,
            providerDefinition,
            requiredImports: [typeName]
        }
    }
}
