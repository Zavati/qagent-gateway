const PROVIDERS = {
  openai: {
    id: 'openai',
    name: 'OpenAI',
    description: 'Use a conta OpenAI da sua organização para geração de testes e autofill.',
    credentialTypes: [
      {
        id: 'api_key',
        name: 'API Key',
        fields: [
          {
            id: 'apiKey',
            label: 'API Key',
            type: 'secret',
            requiredOnCreate: true,
          },
        ],
      },
    ],
    capabilities: ['test_generation', 'autofill'],
    modelFields: [
      {
        id: 'generateTests',
        label: 'Modelo para geração de testes',
        required: true,
      },
      {
        id: 'autofill',
        label: 'Modelo para autofill',
        required: false,
      },
    ],
  },
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function getProviderDefinition(providerValue) {
  const id = String(providerValue || '').trim().toLowerCase();
  const provider = PROVIDERS[id];
  return provider ? clone(provider) : null;
}

export function listProviderDefinitions() {
  return Object.values(PROVIDERS).map(clone);
}

export function getSupportedCredentialTypeIds(providerValue) {
  const provider = getProviderDefinition(providerValue);
  return provider?.credentialTypes?.map((item) => item.id) || [];
}
