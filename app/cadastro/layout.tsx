import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Cadastro de Empresa — NevesGo',
  description: 'Cadastre sua empresa para utilizar os serviços de entrega da Expresso Neves',
};

export default function CadastroLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
