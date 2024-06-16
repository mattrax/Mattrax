import { FaBrandsDiscord, FaBrandsGithub } from 'solid-icons/fa';


const links = [
    {icon: FaBrandsGithub, href: "https://github.com/mattrax/Mattrax"},
    {icon: FaBrandsDiscord, href: "https://discord.gg/WPBHmDSfAn"},
]


const Social = () => {
    return (
        <div class='flex gap-3 justify-center mt-10'>
            {links.map(({icon, href}) => (
                 <a class='transition-all duration-300 hover:opacity-60' href={href} target="_blank" rel="noreferrer">
                    {icon({size: 28, class: 'text-blue-500'})}
                </a>
            ))}
        </div>
    );
};

export default Social;