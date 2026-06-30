# totem

An Electron application with React and TypeScript

## Recommended IDE Setup

- [VSCode](https://code.visualstudio.com/) + [ESLint](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint) + [Prettier](https://marketplace.visualstudio.com/items?itemName=esbenp.prettier-vscode)

## Project Setup

### Install

```bash
$ npm install
```

### Development

```bash
$ npm run dev
```

### Build

```bash
# For windows
$ npm run build:win

# For macOS
$ npm run build:mac

# For Linux
$ npm run build:linux
```

## Release no GitHub

### Como funciona

A aplicacao empacotada verifica novas versoes no GitHub Releases do repositorio.
Quando encontra uma versao mais nova:

- baixa em segundo plano
- espera a app voltar para a tela inicial
- instala a atualizacao automaticamente

### Fluxo recomendado

1. Atualize a versao no `package.json`

```bash
$ npm run release:patch
```

Ou use:

```bash
$ npm run release:minor
$ npm run release:major
```

2. Gere e publique a release para Windows

```bash
$ npm run publish:win
```

3. O `electron-builder` envia os artefatos para o GitHub Release da versao atual

### GH_TOKEN

Para publicar no GitHub, a maquina que roda o comando precisa de um token pessoal do GitHub no ambiente.

Esse token:

- autentica a publicacao
- permite criar/atualizar GitHub Releases
- nao deve ser salvo no repositorio

No Windows PowerShell, para testar na sessao atual:

```powershell
$env:GH_TOKEN = "seu_token_aqui"
```

Para persistir no usuario atual:

```powershell
[Environment]::SetEnvironmentVariable("GH_TOKEN", "seu_token_aqui", "User")
```

Depois de definir de forma persistente, feche e abra o terminal novamente.

Para conferir:

```powershell
echo $env:GH_TOKEN
```

Se estiver configurado, o comando abaixo publica a release:

```bash
$ npm run publish:win
```

### Permissao recomendada do token

No GitHub, crie um Personal Access Token com permissao para:

- `repo`

Se usar Fine-grained token, garanta permissao de escrita em:

- `Contents`
- `Metadata`

E acesso ao repositorio:

- `Jhoelber/TotemArrecadacao`
