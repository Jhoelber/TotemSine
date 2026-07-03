import { getDefaultPrinter, print } from 'pdf-to-printer'

export async function getPrinterHealth() {
  const defaultPrinter = await getDefaultPrinter()

  if (!defaultPrinter?.name) {
    return {
      available: false,
      message: 'Nenhuma impressora padrao foi encontrada no Windows.'
    }
  }

  return {
    available: true,
    name: defaultPrinter.name,
    message: ''
  }
}

export async function printPdfDefault(pdfPath: string) {
  const defaultPrinter = await getPrinterHealth()

  if (!defaultPrinter.available || !defaultPrinter.name) {
    throw new Error(
      defaultPrinter.message || 'Nenhuma impressora padrao foi encontrada no Windows.'
    )
  }

  console.log('[printPdfDefault] impressora padrao:', defaultPrinter.name)
  console.log('[printPdfDefault] arquivo:', pdfPath)

  await print(pdfPath, {
    printer: defaultPrinter.name,
    silent: true
  })
}
